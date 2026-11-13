import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { PrismaClient, Profile } from "@prisma/client";
import {
  hashPassword,
  validatePassword,
  verifyPassword,
} from "./password";
import {
  SESSION_TTL_MS,
  hashSessionToken,
  newSessionId,
  newSessionToken,
} from "./session";
import {
  AuthFailure,
  createSessionCore,
  type AuthContext,
  type AuthVia,
  type DeviceSession,
  type LoginResult,
  type SessionMetadata,
} from "./internal";
import { SessionsService } from "./sessions";
import {
  cleanupExpiredPersonalDataArtifacts,
  purgeInactiveProfiles,
} from "../gdpr/personal-data";
import type { OAuthConfig, OAuthIdentity, OAuthProvider } from "./oauth";
import { exchangeAuthorizationCode, fetchOAuthIdentity, safeEqualStrings } from "./oauth";
import { resetProfilePasswordCore } from "./profile-admin";
import { RateLimiter } from "../rate-limit";

// Re-exported for the consumers that import from ./service (routes, passkeys,
// admin); the definitions live in ./internal.
export { AuthFailure } from "./internal";
export type {
  AuthRole,
  AuthVia,
  SessionProfile,
  AuthContext,
  SessionMetadata,
  DeviceSession,
  LoginResult,
} from "./internal";

export interface AuthServiceOptions {
  prisma: PrismaClient;
  appPassword?: string;
  /** External OAuth providers for the production demo (spec 32 / ADR 023). */
  oauth?: OAuthConfig;
  /** Test seam for expiry and lockout. */
  now?: () => Date;
}

const IP_WINDOW_MS = 10 * 60 * 1000;
const IP_MAX_FAILURES = 20;
const LOCK_AFTER = 5;
/** Per-IP ceiling on failed OAuth callback attempts before the flow is throttled (spec 32). */
const OAUTH_MAX_ATTEMPTS = 10;

/**
 * All authentication state and rules in one place.
 *
 * The routes are deliberately thin: they validate the envelope, call this, and
 * translate `AuthFailure` into the API error contract. That keeps the rules
 * testable without Fastify and stops a route from quietly inventing a weaker
 * check.
 */
export class AuthService {
  readonly enabled: boolean;
  readonly oauth: OAuthConfig;
  private readonly prisma: PrismaClient;
  private readonly appPassword: string | undefined;
  private readonly now: () => Date;
  private readonly ipFailures = new RateLimiter(IP_WINDOW_MS);
  private readonly oauthFailures = new RateLimiter(IP_WINDOW_MS);
  private readonly accountSignups = new RateLimiter(IP_WINDOW_MS);
  private readonly sessions: SessionsService;

  constructor(options: AuthServiceOptions) {
    this.prisma = options.prisma;
    this.appPassword = options.appPassword;
    this.oauth = options.oauth ?? { enabled: false, providers: [] };
    this.enabled = Boolean(options.appPassword);
    this.now = options.now ?? (() => new Date());
    // Same `now` seam: tests that freeze time freeze both halves.
    this.sessions = new SessionsService({ prisma: this.prisma, now: this.now });
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
    this.checkIp(ip);

    const expected = createHash("sha256").update(this.appPassword as string).digest();
    const provided = createHash("sha256").update(password).digest();
    if (!timingSafeEqual(expected, provided)) {
      this.recordIpFailure(ip);
      throw new AuthFailure(401, "incorrect_password");
    }

    this.clearIp(ip);
    return this.createSession(null, "household", meta);
  }

  async registerProfile(
    name: string,
    householdPassword: string,
    password: string,
    meta: SessionMetadata,
    ip: string,
  ): Promise<LoginResult> {
    if (!this.enabled) throw new AuthFailure(400, "request_invalid");
    this.checkIp(ip);

    const expected = createHash("sha256").update(this.appPassword as string).digest();
    const provided = createHash("sha256").update(householdPassword).digest();
    if (!timingSafeEqual(expected, provided)) {
      this.recordIpFailure(ip);
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

    this.clearIp(ip);
    return result;
  }

  async loginProfile(
    profileId: number,
    password: string,
    meta: SessionMetadata,
    ip: string,
  ): Promise<LoginResult> {
    this.checkIp(ip);

    const profile = await this.prisma.profile.findUnique({ where: { id: profileId } });
    if (!profile) {
      // Same work as a real profile, so a missing profile is not a cheap
      // oracle. The answer is identical to a wrong password.
      await hashPassword(password);
      this.recordIpFailure(ip);
      throw new AuthFailure(401, "incorrect_password");
    }

    if (profile.disabled) throw new AuthFailure(403, "account_disabled");
    if (!profile.passwordHash) throw new AuthFailure(409, "profile_unclaimed");

    const lockedFor = this.lockedSeconds(profile);
    if (lockedFor > 0) {
      throw new AuthFailure(429, "account_locked", { retryAfterSeconds: lockedFor });
    }

    const ok = await verifyPassword(password, profile.passwordHash);
    if (!ok) {
      const lockedUntil = await this.recordProfileFailure(profile);
      this.recordIpFailure(ip);
      if (lockedUntil) {
        throw new AuthFailure(429, "account_locked", {
          retryAfterSeconds: this.secondsUntil(lockedUntil),
        });
      }
      throw new AuthFailure(401, "incorrect_password");
    }

    this.clearIp(ip);
    await this.prisma.profile.update({
      where: { id: profile.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: this.now(), lastActiveAt: this.now() },
    });
    return this.createSession(profile.id, "profile", meta);
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
    if (!this.oauth.enabled || !input.provider) throw new AuthFailure(503, "oauth_not_configured");
    this.checkOAuthRate(input.ip);
    try {
      if (!input.stateCookieValue || !safeEqualStrings(input.state, input.stateCookieValue)) {
        throw new AuthFailure(400, "oauth_state_mismatch");
      }

      const token = await exchangeAuthorizationCode(input.provider, {
        code: input.code,
        redirectUri: input.redirectUri,
        codeVerifier: input.codeVerifier,
      });

      let identity: OAuthIdentity;
      try {
        identity = await fetchOAuthIdentity(input.provider, token.accessToken);
      } catch (error) {
        if (error instanceof Error && error.message === "oauth_identity_unavailable") {
          throw new AuthFailure(502, "oauth_identity_unavailable");
        }
        throw error;
      }
      if (!identity.sub || identity.sub.length > 255) throw new AuthFailure(401, "oauth_identity_invalid");
      if (input.provider.id === "google" && (!identity.email || !identity.emailVerified)) {
        throw new AuthFailure(403, "oauth_email_not_verified");
      }
      if (input.provider.id === "github" && identity.email && !identity.emailVerified) {
        throw new AuthFailure(403, "oauth_email_not_verified");
      }

      const profile = await this.resolveOAuthProfile(input.provider, identity);
      if (profile.disabled) throw new AuthFailure(403, "account_disabled");
      this.clearOAuthRate(input.ip);
      return this.createSession(profile.id, "oauth", input.meta);
    } catch (error) {
      this.recordOAuthFailure(input.ip);
      throw error;
    }
  }

  /**
   * Native OAuth handoff (spec 32 / ADR 030): mint the single-use,
   * 60-second, state-bound handle the Custom Tab deep-links back to the
   * app with. Code and state are hashed at rest; neither appears anywhere
   * else, and no token does either.
   */
  async createOAuthHandoff(input: { profileId: number; state: string }): Promise<{ code: string }> {
    const code = randomBytes(32).toString("base64url");
    await this.prisma.oAuthHandoff.create({
      data: {
        codeHash: hashSessionToken(code),
        stateHash: hashSessionToken(input.state),
        profileId: input.profileId,
        expiresAt: new Date(this.now().getTime() + 60_000),
      },
    });
    return { code };
  }

  /**
   * Native OAuth handoff exchange. A replayed, unknown, expired or
   * half-correct request produces no session; the session is minted here,
   * at consumption time, so none exists anywhere before this call.
   */
  async consumeOAuthHandoff(input: {
    code: string;
    state: string;
    meta: SessionMetadata;
    ip: string;
  }): Promise<LoginResult> {
    this.checkOAuthRate(input.ip);
    try {
      const now = this.now();
      const codeHash = hashSessionToken(input.code);
      const row = await this.prisma.oAuthHandoff.findUnique({ where: { codeHash } });
      if (!row || row.consumedAt || row.expiresAt <= now) {
        throw new AuthFailure(401, "oauth_handoff_invalid");
      }
      if (!safeEqualStrings(row.stateHash, hashSessionToken(input.state))) {
        throw new AuthFailure(400, "oauth_state_mismatch");
      }
      const consumed = await this.prisma.oAuthHandoff.updateMany({
        where: { codeHash, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) {
        throw new AuthFailure(401, "oauth_handoff_invalid");
      }
      const profile = await this.prisma.profile.findUnique({ where: { id: row.profileId } });
      if (!profile || profile.disabled) throw new AuthFailure(403, "account_disabled");
      this.clearOAuthRate(input.ip);
      return this.createSession(profile.id, "oauth", input.meta);
    } catch (error) {
      this.recordOAuthFailure(input.ip);
      throw error;
    }
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
    this.checkIp(input.ip);
    const email = input.email.trim().toLowerCase();
    const profile = email ? await this.prisma.profile.findFirst({ where: { email } }) : null;
    if (!profile) {
      this.recordIpFailure(input.ip);
      throw new AuthFailure(401, "incorrect_password");
    }
    if (profile.disabled) throw new AuthFailure(403, "account_disabled");
    if (!profile.passwordHash) throw new AuthFailure(409, "profile_unclaimed");

    const lockedFor = this.lockedSeconds(profile);
    if (lockedFor > 0) {
      throw new AuthFailure(429, "account_locked", { retryAfterSeconds: lockedFor });
    }
    const ok = await verifyPassword(input.password, profile.passwordHash);
    if (!ok) {
      const lockedUntil = await this.recordProfileFailure(profile);
      this.recordIpFailure(input.ip);
      if (lockedUntil) {
        throw new AuthFailure(429, "account_locked", {
          retryAfterSeconds: this.secondsUntil(lockedUntil),
        });
      }
      throw new AuthFailure(401, "incorrect_password");
    }

    this.clearIp(input.ip);
    await this.prisma.profile.update({
      where: { id: profile.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: this.now(), lastActiveAt: this.now() },
    });
    return this.createSession(profile.id, "profile", input.meta);
  }

  async signUpWithEmail(input: {
    email: string;
    password: string;
    meta: SessionMetadata;
    ip: string;
  }): Promise<LoginResult> {
    this.checkSignupRate(input.ip);
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
      this.recordSignupFailure(input.ip);
      throw new AuthFailure(409, "account_creation_unavailable");
    }
    this.accountSignups.clear(input.ip);
    return this.createSession(profile.id, "profile", input.meta);
  }

  /**
   * Resolve an OAuth identity to a profile (spec 32): by provider + provider
   * user id first, then by verified email, else create a new member profile
   * against the hosted library (the production demo audience).
   */
  private async resolveOAuthProfile(provider: OAuthProvider, identity: OAuthIdentity): Promise<Profile> {
    const byProvider = await this.prisma.profile.findFirst({
      where: { oauthProvider: provider.id, oauthProviderId: identity.sub },
    });
    if (byProvider) {
      if (byProvider.disabled) throw new AuthFailure(403, "account_disabled");
      return byProvider;
    }

    const byEmail = identity.email && identity.emailVerified
      ? await this.prisma.profile.findFirst({ where: { email: identity.email.toLowerCase() } })
      : null;
    if (byEmail) {
      if (byEmail.disabled) throw new AuthFailure(403, "account_disabled");
      // Do not silently attach a provider identity to an existing account.
      // Account-linking UX and proof of control for a second credential are deferred.
      throw new AuthFailure(409, "account_linking_required");
    }

    const baseName = (identity.name ?? "").trim() || identity.email?.split("@")[0] || `Listener ${provider.id}`;
    let name = baseName;
    for (let attempt = 2; ; attempt += 1) {
      const clash = await this.prisma.profile.findUnique({ where: { name } });
      if (!clash) break;
      name = `${baseName} ${attempt}`;
    }

    const profile = await this.prisma.profile.create({
      data: {
        name,
        role: "member",
        followsServerLibrary: true,
        email: identity.email,
        oauthProvider: provider.id,
        oauthProviderId: identity.sub,
        lastActiveAt: this.now(),
      },
    });
    return profile;
  }

  /**
   * Claim an unclaimed profile with the break-glass key. This is the only place
   * a normal person ever types the household key besides recovery.
   */
  async claim(
    profileId: number,
    householdPassword: string,
    newPassword: string,
    meta: SessionMetadata,
    ip: string,
  ): Promise<LoginResult> {
    if (!this.enabled) throw new AuthFailure(400, "request_invalid");
    this.checkIp(ip);

    const expected = createHash("sha256").update(this.appPassword as string).digest();
    const provided = createHash("sha256").update(householdPassword).digest();
    if (!timingSafeEqual(expected, provided)) {
      this.recordIpFailure(ip);
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

    this.clearIp(ip);
    return this.createSession(profileId, "profile", meta);
  }

  async changePassword(
    context: AuthContext,
    currentPassword: string,
    newPassword: string,
  ): Promise<Profile> {
    if (!context.profile) throw new AuthFailure(403, "forbidden");
    const profile = context.profile;
    // The hash never travels in the request context; this rare operation
    // reads it, compares it, and drops it.
    const record = await this.prisma.profile.findUnique({
      where: { id: profile.id },
      select: { passwordHash: true },
    });
    if (!(await verifyPassword(currentPassword, record?.passwordHash))) {
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
    return resetProfilePasswordCore(this.prisma, targetId, newPassword, this.now());
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
   *
   * `deviceCredentialId` links the session to the device it was minted from
   * (spec 36). It is the anchor for "one session per device": the link is
   * server-generated, so a client cannot point a session at somebody else's
   * credential.
   */
  // Sessions and devices live in ./sessions (spec 37 candidate 4). The
  // facade delegates so auth/routes.ts and auth/passkeys.ts never change.

  async createProfileSession(
    ...args: Parameters<SessionsService["createProfileSession"]>
  ): Promise<LoginResult> {
    return this.sessions.createProfileSession(...args);
  }

  async createDeviceCredential(
    ...args: Parameters<SessionsService["createDeviceCredential"]>
  ): ReturnType<SessionsService["createDeviceCredential"]> {
    return this.sessions.createDeviceCredential(...args);
  }

  async exchangeDeviceCredential(
    ...args: Parameters<SessionsService["exchangeDeviceCredential"]>
  ): Promise<LoginResult> {
    return this.sessions.exchangeDeviceCredential(...args);
  }

  async listDeviceCredentials(
    ...args: Parameters<SessionsService["listDeviceCredentials"]>
  ): ReturnType<SessionsService["listDeviceCredentials"]> {
    return this.sessions.listDeviceCredentials(...args);
  }

  async revokeDeviceCredential(
    ...args: Parameters<SessionsService["revokeDeviceCredential"]>
  ): Promise<void> {
    return this.sessions.revokeDeviceCredential(...args);
  }

  async validate(
    ...args: Parameters<SessionsService["validate"]>
  ): Promise<AuthContext | null> {
    return this.sessions.validate(...args);
  }

  async revokeToken(
    ...args: Parameters<SessionsService["revokeToken"]>
  ): Promise<void> {
    return this.sessions.revokeToken(...args);
  }

  async listDevices(
    ...args: Parameters<SessionsService["listDevices"]>
  ): Promise<DeviceSession[]> {
    return this.sessions.listDevices(...args);
  }

  async revokeDeviceSessions(
    ...args: Parameters<SessionsService["revokeDeviceSessions"]>
  ): Promise<number> {
    return this.sessions.revokeDeviceSessions(...args);
  }

  async revokeOtherSessions(
    ...args: Parameters<SessionsService["revokeOtherSessions"]>
  ): Promise<number> {
    return this.sessions.revokeOtherSessions(...args);
  }

  async revokeSession(
    ...args: Parameters<SessionsService["revokeSession"]>
  ): Promise<void> {
    return this.sessions.revokeSession(...args);
  }


  /** Best effort; correctness never depends on this having run. */
  async cleanupExpired(): Promise<void> {
    const now = this.now();
    await cleanupExpiredPersonalDataArtifacts(this.prisma, now);
    // Admin sessions follow the same TTL rules as profile sessions.
    await this.prisma.adminSession.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: now } }, { revokedAt: { not: null } }],
      },
    });
    await purgeInactiveProfiles(this.prisma, now);
  }

  private createSession(
    profileId: number | null,
    via: AuthVia,
    meta: SessionMetadata,
    options: { deviceCredentialId?: string | null; deviceLabel?: string | null } = {},
  ): Promise<LoginResult> {
    return createSessionCore(this.prisma, this.now, profileId, via, meta, options);
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

  private lockedSeconds(profile: Profile): number {
    if (!profile.lockedUntil) return 0;
    // Deliberately not `secondsUntil`: that clamps to at least 1 for the
    // retry-after header, which would make an expired lock look permanent.
    const remaining = profile.lockedUntil.getTime() - this.now().getTime();
    return Math.max(0, Math.ceil(remaining / 1000));
  }

  private secondsUntil(date: Date): number {
    return Math.max(1, Math.ceil((date.getTime() - this.now().getTime()) / 1000));
  }

  private async recordProfileFailure(profile: Profile): Promise<Date | null> {
    const count = profile.failedLoginCount + 1;
    let lockedUntil: Date | null = null;
    if (count >= LOCK_AFTER) {
      const exponent = Math.min(count - LOCK_AFTER, 5);
      const seconds = Math.min(30 * 2 ** exponent, 900);
      lockedUntil = new Date(this.now().getTime() + seconds * 1000);
    }
    await this.prisma.profile.update({
      where: { id: profile.id },
      data: { failedLoginCount: count, lockedUntil },
    });
    return lockedUntil;
  }

  /** Per-IP limiter covers unknown profiles and the household key too. */
  private checkIp(ip: string): void {
    const { allowed, retryAfterSeconds } = this.ipFailures.allow(ip, IP_MAX_FAILURES, this.now().getTime());
    if (!allowed) throw new AuthFailure(429, "account_locked", { retryAfterSeconds });
  }

  private recordIpFailure(ip: string): void {
    this.ipFailures.record(ip, this.now().getTime());
  }

  private clearIp(ip: string): void {
    this.ipFailures.clear(ip);
  }

  /** Per-IP ceiling on failed external sign-in attempts before throttling (spec 32). */
  private checkOAuthRate(ip: string): void {
    const { allowed, retryAfterSeconds } = this.oauthFailures.allow(ip, OAUTH_MAX_ATTEMPTS, this.now().getTime());
    if (!allowed) throw new AuthFailure(429, "oauth_rate_limited", { retryAfterSeconds });
  }

  private recordOAuthFailure(ip: string): void {
    this.oauthFailures.record(ip, this.now().getTime());
  }

  private clearOAuthRate(ip: string): void {
    this.oauthFailures.clear(ip);
  }

  private checkSignupRate(ip: string): void {
    const { allowed, retryAfterSeconds } = this.accountSignups.allow(ip, 5, this.now().getTime());
    if (!allowed) throw new AuthFailure(429, "oauth_rate_limited", { retryAfterSeconds });
  }

  private recordSignupFailure(ip: string): void {
    this.accountSignups.record(ip, this.now().getTime());
  }
}
