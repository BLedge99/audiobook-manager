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

export type AuthRole = "admin" | "member";
export type AuthVia = "profile" | "household" | "device";

export interface AuthContext {
  token: string;
  session: Session;
  profile: Profile | null;
  role: AuthRole;
  via: AuthVia;
}

export interface SessionMetadata {
  userAgent?: string | null;
  deviceLabel?: string | null;
}

export interface LoginResult {
  token: string;
  session: Session;
  profile: Profile | null;
  role: AuthRole;
}

export class AuthFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    readonly params?: ApiErrorParams,
  ) {
    super(code);
    this.name = "AuthFailure";
  }
}

export interface AuthServiceOptions {
  prisma: PrismaClient;
  appPassword?: string;
  /** Test seam for expiry and lockout. */
  now?: () => Date;
}

const IP_WINDOW_MS = 10 * 60 * 1000;
const IP_MAX_FAILURES = 20;
const LOCK_AFTER = 5;

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
  private readonly prisma: PrismaClient;
  private readonly appPassword: string | undefined;
  private readonly now: () => Date;
  private readonly ipFailures = new Map<string, { count: number; resetAt: number }>();

  constructor(options: AuthServiceOptions) {
    this.prisma = options.prisma;
    this.appPassword = options.appPassword;
    this.enabled = Boolean(options.appPassword);
    this.now = options.now ?? (() => new Date());
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
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: this.now() },
    });
    return this.createSession(profile.id, "profile", meta);
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
    return this.createSession(profileId, via, meta);
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
    return this.createProfileSession(credential.profileId, "device", meta);
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
    const tokenHash = hashSessionToken(token);
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: { profile: true },
    });
    if (!session) return null;
    if (session.revokedAt) return null;

    const now = this.now();
    if (session.expiresAt.getTime() <= now.getTime()) return null;
    if (session.profile?.disabled) return null;

    const cap = new Date(session.createdAt.getTime() + SESSION_MAX_AGE_MS);
    let expiresAt = session.expiresAt;
    if (
      now.getTime() > session.expiresAt.getTime() - SESSION_RENEW_WINDOW_MS &&
      now.getTime() < cap.getTime()
    ) {
      const proposed = new Date(now.getTime() + SESSION_TTL_MS);
      expiresAt = proposed.getTime() < cap.getTime() ? proposed : cap;
    }

    const shouldTouch = now.getTime() - session.lastUsedAt.getTime() > SESSION_TOUCH_MS;
    if (shouldTouch || expiresAt.getTime() !== session.expiresAt.getTime()) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: {
          lastUsedAt: shouldTouch ? now : session.lastUsedAt,
          expiresAt,
        },
      });
      session.lastUsedAt = shouldTouch ? now : session.lastUsedAt;
      session.expiresAt = expiresAt;
    }

    const role: AuthRole = session.profile?.role === "admin" ? "admin" : session.profile ? "member" : "admin";
    return {
      token,
      session,
      profile: session.profile,
      role,
      via: session.via as AuthVia,
    };
  }

  async revokeToken(token: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { tokenHash: hashSessionToken(token), revokedAt: null },
      data: { revokedAt: this.now() },
    });
  }

  async listSessions(context: AuthContext) {
    if (!context.profile) return [];
    const rows = await this.prisma.session.findMany({
      where: { profileId: context.profile.id, revokedAt: null, expiresAt: { gt: this.now() } },
      orderBy: { lastUsedAt: "desc" },
    });
    return rows.map((row) => ({
      id: row.id,
      deviceLabel: row.deviceLabel,
      userAgent: row.userAgent,
      via: row.via,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
      expiresAt: row.expiresAt,
      current: row.id === context.session.id,
    }));
  }

  async revokeSession(context: AuthContext, sessionId: string): Promise<void> {
    if (!context.profile) throw new AuthFailure(404, "session_not_found");
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, profileId: context.profile.id },
      select: { id: true },
    });
    if (!session) throw new AuthFailure(404, "session_not_found");
    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: this.now() },
    });
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
  }

  private async createSession(
    profileId: number | null,
    via: AuthVia,
    meta: SessionMetadata,
  ): Promise<LoginResult> {
    const token = newSessionToken();
    const now = this.now();
    const session = await this.prisma.session.create({
      data: {
        id: newSessionId(),
        tokenHash: hashSessionToken(token),
        profileId,
        via,
        userAgent: meta.userAgent?.slice(0, 500) ?? null,
        deviceLabel: meta.deviceLabel?.slice(0, 100) ?? null,
        createdAt: now,
        lastUsedAt: now,
        expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      },
    });
    const profile = profileId
      ? await this.prisma.profile.findUnique({ where: { id: profileId } })
      : null;
    return {
      token,
      session,
      profile,
      role: profile?.role === "admin" ? "admin" : profile ? "member" : "admin",
    };
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
    const entry = this.ipFailures.get(ip);
    if (!entry) return;
    if (this.now().getTime() >= entry.resetAt) {
      this.ipFailures.delete(ip);
      return;
    }
    if (entry.count >= IP_MAX_FAILURES) {
      throw new AuthFailure(429, "account_locked", {
        retryAfterSeconds: Math.ceil((entry.resetAt - this.now().getTime()) / 1000),
      });
    }
  }

  private recordIpFailure(ip: string): void {
    const now = this.now().getTime();
    const entry = this.ipFailures.get(ip);
    if (!entry || now >= entry.resetAt) {
      this.ipFailures.set(ip, { count: 1, resetAt: now + IP_WINDOW_MS });
      return;
    }
    entry.count += 1;
  }

  private clearIp(ip: string): void {
    this.ipFailures.delete(ip);
  }
}
