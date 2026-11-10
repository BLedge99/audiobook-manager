import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { PrismaClient, Profile, Session } from "@prisma/client";
import type { ApiErrorCode, ApiErrorParams } from "../http-errors";
import {
  hashPassword,
  validatePassword,
  verifyPassword,
} from "./password";
import {
  SESSION_MAX_AGE_MS,
  SESSION_RENEW_WINDOW_MS,
  SESSION_TOUCH_MS,
  SESSION_TTL_MS,
  hashSessionToken,
  newSessionId,
  newSessionToken,
} from "./session";
import type { OAuthConfig, OAuthIdentity, OAuthProvider } from "./oauth";
import { exchangeAuthorizationCode, fetchOAuthIdentity, safeEqualStrings } from "./oauth";

// Import types from service-types first
import {
  AuthRole,
  AuthVia,
  AuthContext,
  SessionMetadata,
  LoginResult,
  AuthFailure,
  AuthServiceOptions,
} from "./service-types";
import { SlidingRateLimiter } from "./lockout";
import { AccountLockout } from "./lockout";
import { OAuthFlow } from "./oauth-flow";
import { SessionManager } from "./session-manager";

// Re-export from service-types for backward compatibility
export {
  AuthRole,
  AuthVia,
  AuthContext,
  SessionMetadata,
  LoginResult,
  AuthFailure,
  AuthServiceOptions,
} from "./service-types";

const IP_WINDOW_MS = 10 * 60 * 1000;
const IP_MAX_FAILURES = 20;
const LOCK_AFTER = 5;
const OAUTH_MAX_ATTEMPTS = 10;

/**
 * All authentication state and rules in one place.
 *
 * The routes are deliberately thin: they validate the envelope, call this, and
 * translate `AuthFailure` into the API error contract. That keeps the rules
 * testable without Fastify and stops a route from quietly inventing a weaker
 * check.
 *
 * This class now delegates to split modules:
 * - SlidingRateLimiter for IP-based rate limiting
 * - AccountLockout for per-profile lockout logic
 * - OAuthFlow for OAuth authorization code flow
 * - SessionManager for session CRUD and validation
 */
export class AuthService {
  readonly enabled: boolean;
  readonly oauth: OAuthConfig;
  private readonly prisma: PrismaClient;
  private readonly appPassword: string | undefined;
  private readonly now: () => Date;
  private readonly ipLimiter: SlidingRateLimiter;
  private readonly oauthLimiter: SlidingRateLimiter;
  private readonly signupLimiter: SlidingRateLimiter;
  private readonly accountLockout: AccountLockout;
  private readonly oauthFlow: OAuthFlow;
  private readonly sessionManager: SessionManager;

  constructor(options: AuthServiceOptions) {
    this.prisma = options.prisma;
    this.appPassword = options.appPassword;
    this.oauth = options.oauth ?? { enabled: false, providers: [] };
    this.enabled = Boolean(options.appPassword);
    this.now = options.now ?? (() => new Date());

    // IP-based rate limiters (delegated to SlidingRateLimiter)
    this.ipLimiter = new SlidingRateLimiter({
      windowMs: IP_WINDOW_MS,
      maxFailures: IP_MAX_FAILURES,
      now: this.now,
      failureErrorCode: "account_locked",
    });
    this.oauthLimiter = new SlidingRateLimiter({
      windowMs: IP_WINDOW_MS,
      maxFailures: OAUTH_MAX_ATTEMPTS,
      now: this.now,
      failureErrorCode: "oauth_rate_limited",
    });
    this.signupLimiter = new SlidingRateLimiter({
      windowMs: IP_WINDOW_MS,
      maxFailures: 5,
      now: this.now,
      failureErrorCode: "oauth_rate_limited",
    });

    // Account lockout logic
    this.accountLockout = new AccountLockout(this.now);

    // Session manager
    this.sessionManager = new SessionManager({
      prisma: this.prisma,
      now: this.now,
    });

    // OAuth flow (needs createSession callback)
    this.oauthFlow = new OAuthFlow({
      prisma: this.prisma,
      oauth: this.oauth,
      rateLimiter: this.oauthLimiter,
      now: this.now,
      createSession: (profileId, via, meta) => this.sessionManager.createSession(profileId, via, meta),
    });
  }

  /**
   * Public account list. No hash, no token, no secret. The names are already
   * on the profile screen, and a person has to choose one to sign in.
   */
  async listAccounts() {
    const profiles = await this.prisma.profile.findMany({
      orderBy: { createdAt: "asc" },
      include: { _count: { select: {
        webauthnCredentials: true,
        deviceCredentials: { where: { revokedAt: null, expiresAt: { gt: this.now() } } },
      } } },
    });
    return profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      color: profile.color,
      role: profile.role === "admin" ? "admin" : "member",
      disabled: profile.disabled,
      hasPassword: Boolean(profile.passwordHash),
      hasPasskey: profile._count.webauthnCredentials > 0,
      hasDeviceUnlock: profile._count.deviceCredentials > 0,
    }));
  }

  async loginHousehold(
    password: string,
    meta: SessionMetadata,
    ip: string,
  ): Promise<LoginResult> {
    if (!this.enabled) throw new AuthFailure(400, "request_invalid");
    this.ipLimiter.check(ip);

    const expected = createHash("sha256").update(this.appPassword as string).digest();
    const provided = createHash("sha256").update(password).digest();
    if (!timingSafeEqual(expected, provided)) {
      this.ipLimiter.record(ip);
      throw new AuthFailure(401, "incorrect_password");
    }

    this.ipLimiter.clear(ip);
    return this.sessionManager.createSession(null, "household", meta);
  }

  async registerProfile(
    name: string,
    householdPassword: string,
    password: string,
    meta: SessionMetadata,
    ip: string,
  ): Promise<LoginResult> {
    if (!this.enabled) throw new AuthFailure(400, "request_invalid");
    this.ipLimiter.check(ip);

    const expected = createHash("sha256").update(this.appPassword as string).digest();
    const provided = createHash("sha256").update(householdPassword).digest();
    if (!timingSafeEqual(expected, provided)) {
      this.ipLimiter.record(ip);
      throw new AuthFailure(401, "incorrect_password");
    }

    const profileName = name.trim();
    if (!profileName) throw new AuthFailure(400, "profile_name_required");
    if (await this.prisma.profile.findUnique({ where: { name: profileName } })) {
      throw new AuthFailure(409, "profile_name_taken");
    }
    this.assertPassword(password, profileName);
    const passwordHash = await hashPassword(password);

    const token = newSessionToken();
    const now = this.now();
    let result: LoginResult;
    try {
      result = await this.prisma.$transaction(async (transaction) => {
        const profile = await transaction.profile.create({
          data: {
            name: profileName,
            passwordHash,
            passwordUpdatedAt: now,
            lastLoginAt: now,
            lastActiveAt: now,
          },
        });
        const session = await transaction.session.create({
          data: {
            id: newSessionId(),
            tokenHash: hashSessionToken(token),
            profileId: profile.id,
            via: "profile",
            userAgent: meta.userAgent?.slice(0, 500) ?? null,
            deviceLabel: meta.deviceLabel?.slice(0, 100) ?? null,
            createdAt: now,
            lastUsedAt: now,
            expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
          },
        });
        return { token, session, profile, role: "member" };
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2002"
      ) {
        throw new AuthFailure(409, "profile_name_taken");
      }
      throw error;
    }

    this.ipLimiter.clear(ip);
    return result;
  }

  async loginProfile(
    profileId: number,
    password: string,
    meta: SessionMetadata,
    ip: string,
  ): Promise<LoginResult> {
    this.ipLimiter.check(ip);

    const profile = await this.prisma.profile.findUnique({ where: { id: profileId } });
    if (!profile) {
      // Same work as a real profile, so a missing profile is not a cheap
      // oracle. The answer is identical to a wrong password.
      await hashPassword(password);
      this.ipLimiter.record(ip);
      throw new AuthFailure(401, "incorrect_password");
    }

    if (profile.disabled) throw new AuthFailure(403, "account_disabled");
    if (!profile.passwordHash) throw new AuthFailure(409, "profile_unclaimed");

    const lockedFor = this.accountLockout.lockedSeconds(profile);
    if (lockedFor > 0) {
      throw new AuthFailure(429, "account_locked", { retryAfterSeconds: lockedFor });
    }

    const ok = await verifyPassword(password, profile.passwordHash);
    if (!ok) {
      const { nextFailures, lockedUntil } = this.accountLockout.computeLockout(profile.failedLoginCount);
      await this.prisma.profile.update({
        where: { id: profile.id },
        data: { failedLoginCount: nextFailures, lockedUntil },
      });
      this.ipLimiter.record(ip);
      if (lockedUntil) {
        throw new AuthFailure(429, "account_locked", {
          retryAfterSeconds: this.accountLockout.secondsUntil(lockedUntil),
        });
      }
      throw new AuthFailure(401, "incorrect_password");
    }

    this.ipLimiter.clear(ip);
    await this.prisma.profile.update({
      where: { id: profile.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: this.now(), lastActiveAt: this.now() },
    });
    return this.sessionManager.createSession(profile.id, "profile", meta);
  }

  /**
   * External sign-in via OAuth (spec 32 / ADR 023): authorize → callback →
   * token exchange → identity → profile → session.
   *
   * The state in the callback must match the value the authorize step wrote to
   * the `oauth_state` cookie; the comparison is hashed and constant-time. The
   * PKCE verifier was generated server-side at authorize time and travels with
   * the token exchange, so the client never holds OAuth secrets.
   */
  async signInWithOAuth(input: {
    provider: OAuthProvider;
    code: string;
    state: string;
    stateCookieValue: string | null;
    codeVerifier: string;
    redirectUri: string;
    meta: SessionMetadata;
    ip: string;
  }): Promise<LoginResult> {
    return this.oauthFlow.signInWithOAuth(input);
  }

  /**
   * Email + password sign-in (spec 32): the same password posture as a profile
   * sign-in, resolved by email instead of profile id. Unknown email answers the
   * same `incorrect_password` as a wrong password, so the endpoint does not
   * become an account-enumeration oracle.
   */
  async signInWithEmail(input: {
    email: string;
    password: string;
    meta: SessionMetadata;
    ip: string;
  }): Promise<LoginResult> {
    this.ipLimiter.check(input.ip);
    const email = input.email.trim().toLowerCase();
    const profile = email ? await this.prisma.profile.findFirst({ where: { email } }) : null;
    if (!profile) {
      this.ipLimiter.record(input.ip);
      throw new AuthFailure(401, "incorrect_password");
    }
    if (profile.disabled) throw new AuthFailure(403, "account_disabled");
    if (!profile.passwordHash) throw new AuthFailure(409, "profile_unclaimed");

    const lockedFor = this.accountLockout.lockedSeconds(profile);
    if (lockedFor > 0) {
      throw new AuthFailure(429, "account_locked", { retryAfterSeconds: lockedFor });
    }
    const ok = await verifyPassword(input.password, profile.passwordHash);
    if (!ok) {
      const { nextFailures, lockedUntil } = this.accountLockout.computeLockout(profile.failedLoginCount);
      await this.prisma.profile.update({
        where: { id: profile.id },
        data: { failedLoginCount: nextFailures, lockedUntil },
      });
      this.ipLimiter.record(input.ip);
      if (lockedUntil) {
        throw new AuthFailure(429, "account_locked", {
          retryAfterSeconds: this.accountLockout.secondsUntil(lockedUntil),
        });
      }
      throw new AuthFailure(401, "incorrect_password");
    }

    this.ipLimiter.clear(input.ip);
    await this.prisma.profile.update({
      where: { id: profile.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: this.now(), lastActiveAt: this.now() },
    });
    return this.sessionManager.createSession(profile.id, "profile", input.meta);
  }

  async signUpWithEmail(input: {
    email: string;
    password: string;
    meta: SessionMetadata;
    ip: string;
  }): Promise<LoginResult> {
    this.signupLimiter.check(input.ip);
    const email = input.email.trim().toLowerCase();
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new AuthFailure(400, "request_invalid");
    }
    if (input.password.length < 12 || input.password.length > 128) {
      throw new AuthFailure(400, input.password.length < 12 ? "password_too_short" : "password_too_long", {
        [input.password.length < 12 ? "minLength" : "maxLength"]: input.password.length < 12 ? 12 : 128,
      });
    }
    this.assertPassword(input.password, "");
    const passwordHash = await hashPassword(input.password);
    const name = `account-${randomUUID()}`;
    let profile: Profile;
    try {
      profile = await this.prisma.profile.create({
        data: { name, email, role: "member", passwordHash, passwordUpdatedAt: this.now(), followsServerLibrary: true, lastActiveAt: this.now() },
      });
    } catch {
      // The unique email constraint is the concurrency-safe duplicate check.
      // Same generic response for duplicate registration; do not reveal which.
      this.signupLimiter.record(input.ip);
      throw new AuthFailure(409, "account_creation_unavailable");
    }
    this.signupLimiter.clear(input.ip);
    return this.sessionManager.createSession(profile.id, "profile", input.meta);
  }

  async claim(
    profileId: number,
    householdPassword: string,
    newPassword: string,
    meta: SessionMetadata,
    ip: string,
  ): Promise<LoginResult> {
    if (!this.enabled) throw new AuthFailure(400, "request_invalid");
    this.ipLimiter.check(ip);

    const expected = createHash("sha256").update(this.appPassword as string).digest();
    const provided = createHash("sha256").update(householdPassword).digest();
    if (!timingSafeEqual(expected, provided)) {
      this.ipLimiter.record(ip);
      throw new AuthFailure(401, "incorrect_password");
    }

    const profile = await this.prisma.profile.findUnique({ where: { id: profileId } });
    if (!profile) throw new AuthFailure(404, "not_found");
    if (profile.passwordHash) throw new AuthFailure(409, "claim_unavailable");

    this.assertPassword(newPassword, profile.name);
    const passwordHash = await hashPassword(newPassword);
    const updated = await this.prisma.profile.updateMany({
      where: { id: profileId, passwordHash: null },
      data: {
        passwordHash,
        passwordUpdatedAt: this.now(),
        failedLoginCount: 0,
        lockedUntil: null,
        lastActiveAt: this.now(),
      },
    });
    if (updated.count === 0) throw new AuthFailure(409, "claim_unavailable");

    this.ipLimiter.clear(ip);
    return this.sessionManager.createSession(profileId, "profile", meta);
  }

  async changePassword(
    context: AuthContext,
    currentPassword: string,
    newPassword: string,
  ): Promise<Profile> {
    if (!context.profile) throw new AuthFailure(403, "forbidden");
    const profile = context.profile;
    if (!(await verifyPassword(currentPassword, profile.passwordHash))) {
      throw new AuthFailure(400, "incorrect_password");
    }

    this.assertPassword(newPassword, profile.name);
    const passwordHash = await hashPassword(newPassword);
    const updated = await this.prisma.profile.update({
      where: { id: profile.id },
      data: {
        passwordHash,
        passwordUpdatedAt: this.now(),
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });

    // The current session stays valid; every other one has to present the new
    // password. The device credentials are deliberately kept until the next
    // device exchange or an explicit revoke.
    await this.prisma.session.updateMany({
      where: { profileId: profile.id, revokedAt: null, id: { not: context.session.id } },
      data: { revokedAt: this.now() },
    });
    return updated;
  }

  async resetPassword(context: AuthContext | null, targetId: number, newPassword: string) {
    this.assertAdmin(context);
    const target = await this.prisma.profile.findUnique({ where: { id: targetId } });
    if (!target) throw new AuthFailure(404, "not_found");
    this.assertPassword(newPassword, target.name);

    const passwordHash = await hashPassword(newPassword);
    const updated = await this.prisma.profile.update({
      where: { id: target.id },
      data: {
        passwordHash,
        passwordUpdatedAt: this.now(),
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });

    const now = this.now();
    await this.prisma.session.updateMany({
      where: { profileId: target.id, revokedAt: null },
      data: { revokedAt: now },
    });
    await this.prisma.deviceCredential.updateMany({
      where: { profileId: target.id, revokedAt: null },
      data: { revokedAt: now },
    });
    return updated;
  }

  async unlockProfile(context: AuthContext | null, targetId: number) {
    this.assertAdmin(context);
    const target = await this.prisma.profile.findUnique({ where: { id: targetId } });
    if (!target) throw new AuthFailure(404, "not_found");
    return this.prisma.profile.update({
      where: { id: target.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
  }

  /**
   * Start a session for a profile that has already proved itself by another
   * method (WebAuthn assertion or device-credential exchange). The checks that
   * matter are repeated here: a disabled profile must not get a session just
   * because its passkey still verifies.
   */
  async createProfileSession(
    profileId: number,
    via: AuthVia,
    meta: SessionMetadata,
  ): Promise<LoginResult> {
    const profile = await this.prisma.profile.findUnique({ where: { id: profileId } });
    if (!profile) throw new AuthFailure(404, "not_found");
    if (profile.disabled) throw new AuthFailure(403, "account_disabled");
    await this.prisma.profile.update({
      where: { id: profileId },
      data: { lastActiveAt: this.now() },
    });
    return this.sessionManager.createSession(profileId, via, meta);
  }

  /** Create a device-bound secret. Only its hash is stored by the server. */
  async createDeviceCredential(profileId: number, label: string | null) {
    const profile = await this.prisma.profile.findUnique({ where: { id: profileId } });
    if (!profile) throw new AuthFailure(404, "not_found");
    if (profile.disabled) throw new AuthFailure(403, "account_disabled");
    const secret = randomBytes(32).toString("base64url");
    const created = await this.prisma.deviceCredential.create({
      data: {
        id: randomUUID(), profileId, secretHash: hashSessionToken(secret),
        label: label?.trim() || null,
        expiresAt: new Date(this.now().getTime() + 90 * 24 * 60 * 60 * 1000),
      },
    });
    return { id: created.id, secret, label: created.label, expiresAt: created.expiresAt };
  }

  async exchangeDeviceCredential(secret: string, meta: SessionMetadata): Promise<LoginResult> {
    const credential = await this.prisma.deviceCredential.findUnique({
      where: { secretHash: hashSessionToken(secret) },
    });
    const now = this.now();
    if (!credential || credential.revokedAt || credential.expiresAt <= now) {
      throw new AuthFailure(401, "device_auth_failed");
    }
    await this.prisma.deviceCredential.update({
      where: { id: credential.id }, data: { lastUsedAt: now },
    });
    return this.sessionManager.createProfileSession(credential.profileId, "device", meta);
  }

  async listDeviceCredentials(profileId: number) {
    return this.prisma.deviceCredential.findMany({
      where: { profileId, revokedAt: null }, orderBy: { createdAt: "asc" },
      select: { id: true, label: true, createdAt: true, lastUsedAt: true, expiresAt: true },
    });
  }

  async revokeDeviceCredential(profileId: number, id: string): Promise<void> {
    const result = await this.prisma.deviceCredential.updateMany({
      where: { id, profileId, revokedAt: null }, data: { revokedAt: this.now() },
    });
    if (!result.count) throw new AuthFailure(404, "device_not_found");
  }

  async validate(token: string): Promise<AuthContext | null> {
    return this.sessionManager.validate(token);
  }

  async revokeToken(token: string): Promise<void> {
    return this.sessionManager.revokeToken(token);
  }

  async listSessions(context: AuthContext) {
    return this.sessionManager.listSessions(context);
  }

  async revokeSession(context: AuthContext, sessionId: string): Promise<void> {
    const ok = await this.sessionManager.revokeSession(context.profile!.id, sessionId);
    if (!ok) throw new AuthFailure(404, "session_not_found");
  }

  /** Best effort; correctness never depends on this having run. */
  async cleanupExpired(): Promise<void> {
    await this.prisma.session.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: this.now() } }, { revokedAt: { not: null } }],
      },
    });
    await this.prisma.webAuthnChallenge.deleteMany({
      where: { expiresAt: { lt: this.now() } },
    });
    // Device credentials carry a 90-day expiry; clean up expired or revoked ones.
    await this.prisma.deviceCredential.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: this.now() } }, { revokedAt: { not: null } }],
      },
    });
    // Admin sessions follow the same TTL rules as profile sessions.
    await this.prisma.adminSession.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: this.now() } }, { revokedAt: { not: null } }],
      },
    });
    // Inactive profiles: no successful authentication for 24 months.
    // Profiles never used fall back to createdAt. Cascade deletes every
    // related personal-data row via the onDelete: Cascade relations.
    const inactiveBefore = new Date(this.now().getTime() - 24 * 30 * 24 * 60 * 60 * 1000);
    const inactiveProfiles = await this.prisma.profile.findMany({
      where: {
        OR: [
          { lastActiveAt: { lt: inactiveBefore } },
          { lastActiveAt: null, createdAt: { lt: inactiveBefore } },
        ],
      },
      select: { id: true },
    });
    for (const profile of inactiveProfiles) {
      await this.prisma.$transaction([
        this.prisma.webAuthnChallenge.deleteMany({ where: { profileId: profile.id } }),
        this.prisma.webAuthnCredential.deleteMany({ where: { profileId: profile.id } }),
        this.prisma.deviceCredential.deleteMany({ where: { profileId: profile.id } }),
        this.prisma.session.deleteMany({ where: { profileId: profile.id } }),
        this.prisma.listeningHistory.deleteMany({ where: { profileId: profile.id } }),
        this.prisma.playSession.deleteMany({ where: { profileId: profile.id } }),
        this.prisma.favourite.deleteMany({ where: { profileId: profile.id } }),
        this.prisma.wishlistItem.deleteMany({ where: { profileId: profile.id } }),
        this.prisma.profileLibraryEntry.deleteMany({ where: { profileId: profile.id } }),
        this.prisma.profile.delete({ where: { id: profile.id } }),
      ]);
    }
  }

  private assertPassword(password: string, profileName: string): void {
    const failure = validatePassword(password, profileName);
    if (failure) throw new AuthFailure(400, failure.code, failure.params);
  }

  private assertAdmin(context: AuthContext | null): asserts context is AuthContext {
    if (!context || context.role !== "admin") {
      throw new AuthFailure(403, "forbidden");
    }
  }
}