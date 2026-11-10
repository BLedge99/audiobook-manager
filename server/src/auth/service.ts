import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { PrismaClient, Profile } from "@prisma/client";
import {
  hashPassword,
  validatePassword,
  verifyPassword,
} from "./password";
import { hashSessionToken } from "./session";
import type { OAuthConfig, OAuthProvider } from "./oauth";
import { AccountLockout, SlidingRateLimiter } from "./lockout";
import { SessionManager } from "./session-manager";
import { OAuthFlow } from "./oauth-flow";
import {
  AuthFailure,
  type AuthContext,
  type AuthServiceOptions,
  type AuthVia,
  type LoginResult,
  type SessionMetadata,
} from "./service-types";

export * from "./service-types";

/**
 * All authentication state and rules behind one unified facade.
 *
 * Decomposes session lifecycle (SessionManager), lockouts / rate limiting
 * (AccountLockout, SlidingRateLimiter), and external identity flows (OAuthFlow)
 * while keeping household break-glass semantics and API surface intact.
 */
export class AuthService {
  readonly enabled: boolean;
  readonly oauth: OAuthConfig;
  private readonly prisma: PrismaClient;
  private readonly appPassword: string | undefined;
  private readonly now: () => Date;

  private readonly sessionManager: SessionManager;
  private readonly lockout: AccountLockout;
  private readonly ipLimiter: SlidingRateLimiter;
  private readonly oauthLimiter: SlidingRateLimiter;
  private readonly signupLimiter: SlidingRateLimiter;
  private readonly oauthFlow: OAuthFlow;

  constructor(options: AuthServiceOptions) {
    this.prisma = options.prisma;
    this.appPassword = options.appPassword;
    this.oauth = options.oauth ?? { enabled: false, providers: [] };
    this.enabled = Boolean(options.appPassword);
    this.now = options.now ?? (() => new Date());

    this.sessionManager = new SessionManager({ prisma: this.prisma, now: this.now });
    this.lockout = new AccountLockout(this.now);
    this.ipLimiter = new SlidingRateLimiter({
      windowMs: 10 * 60 * 1000,
      maxFailures: 20,
      now: this.now,
      failureErrorCode: "account_locked",
    });
    this.oauthLimiter = new SlidingRateLimiter({
      windowMs: 10 * 60 * 1000,
      maxFailures: 10,
      now: this.now,
      failureErrorCode: "oauth_rate_limited",
    });
    this.signupLimiter = new SlidingRateLimiter({
      windowMs: 10 * 60 * 1000,
      maxFailures: 5,
      now: this.now,
      failureErrorCode: "oauth_rate_limited",
    });

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
      include: {
        _count: {
          select: {
            webauthnCredentials: true,
            deviceCredentials: { where: { revokedAt: null, expiresAt: { gt: this.now() } } },
          },
        },
      },
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

    const lockedFor = this.lockout.lockedSeconds(profile);
    if (lockedFor > 0) {
      throw new AuthFailure(429, "account_locked", { retryAfterSeconds: lockedFor });
    }

    const ok = await verifyPassword(password, profile.passwordHash);
    if (!ok) {
      const lockedUntil = await this.recordProfileFailure(profile);
      this.ipLimiter.record(ip);
      if (lockedUntil) {
        throw new AuthFailure(429, "account_locked", {
          retryAfterSeconds: this.lockout.secondsUntil(lockedUntil),
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

    const lockedFor = this.lockout.lockedSeconds(profile);
    if (lockedFor > 0) {
      throw new AuthFailure(429, "account_locked", { retryAfterSeconds: lockedFor });
    }
    const ok = await verifyPassword(input.password, profile.passwordHash);
    if (!ok) {
      const lockedUntil = await this.recordProfileFailure(profile);
      this.ipLimiter.record(input.ip);
      if (lockedUntil) {
        throw new AuthFailure(429, "account_locked", {
          retryAfterSeconds: this.lockout.secondsUntil(lockedUntil),
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

  async createDeviceCredential(profileId: number, label: string | null) {
    const profile = await this.prisma.profile.findUnique({ where: { id: profileId } });
    if (!profile) throw new AuthFailure(404, "not_found");
    if (profile.disabled) throw new AuthFailure(403, "account_disabled");
    const secret = randomBytes(32).toString("base64url");
    const created = await this.prisma.deviceCredential.create({
      data: {
        id: randomUUID(),
        profileId,
        secretHash: hashSessionToken(secret),
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
      where: { id: credential.id },
      data: { lastUsedAt: now },
    });
    return this.createProfileSession(credential.profileId, "device", meta);
  }

  async listDeviceCredentials(profileId: number) {
    return this.prisma.deviceCredential.findMany({
      where: { profileId, revokedAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true, label: true, createdAt: true, lastUsedAt: true, expiresAt: true },
    });
  }

  async revokeDeviceCredential(profileId: number, id: string): Promise<void> {
    const result = await this.prisma.deviceCredential.updateMany({
      where: { id, profileId, revokedAt: null },
      data: { revokedAt: this.now() },
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
    if (!context.profile) throw new AuthFailure(404, "session_not_found");
    const ok = await this.sessionManager.revokeSession(context.profile.id, sessionId);
    if (!ok) throw new AuthFailure(404, "session_not_found");
  }

  async cleanupExpired(): Promise<void> {
    await this.prisma.session.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: this.now() } }, { revokedAt: { not: null } }],
      },
    });
    await this.prisma.webAuthnChallenge.deleteMany({
      where: { expiresAt: { lt: this.now() } },
    });
    await this.prisma.deviceCredential.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: this.now() } }, { revokedAt: { not: null } }],
      },
    });
    await this.prisma.adminSession.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: this.now() } }, { revokedAt: { not: null } }],
      },
    });

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

  private async recordProfileFailure(profile: Profile): Promise<Date | null> {
    const { nextFailures, lockedUntil } = this.lockout.computeLockout(profile.failedLoginCount);
    await this.prisma.profile.update({
      where: { id: profile.id },
      data: { failedLoginCount: nextFailures, lockedUntil },
    });
    return lockedUntil;
  }
}
