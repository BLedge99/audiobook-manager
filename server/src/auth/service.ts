import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { DeviceCredential, PrismaClient, Profile, Session } from "@prisma/client";
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
  sessionExpiry,
} from "./session";
import type { OAuthConfig, OAuthIdentity, OAuthProvider } from "./oauth";
import { exchangeAuthorizationCode, fetchOAuthIdentity, safeEqualStrings } from "./oauth";

export type AuthRole = "admin" | "member";
export type AuthVia = "profile" | "household" | "device" | "oauth";

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

/**
 * One signed-in device, as the "Signed-in devices" panel shows it.
 *
 * Spec 36: a device, not a sign-in. A device is a device credential (Android)
 * or a browser session (web); the panel groups by that and says how many live
 * sessions the device holds.
 */
export interface DeviceSession {
  /** Opaque key: the device credential's id, or the session id for a browser. */
  key: string;
  /** The enrolled device name, or a label derived from the user agent. */
  label: string | null;
  /** The raw user agent, so a listener can tell two similar devices apart. */
  userAgent: string | null;
  /** The client's own installation id, when the device reported one. */
  deviceId: string | null;
  via: string;
  /** When this device was first signed in. */
  createdAt: Date;
  /** When it was last used. */
  lastActiveAt: Date;
  /** True when the caller's own session belongs to this device. */
  current: boolean;
  /** How many live sessions this device holds. */
  sessions: number;
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
  private readonly ipFailures = new Map<string, { count: number; resetAt: number }>();
  private readonly oauthFailures = new Map<string, { count: number; resetAt: number }>();
  private readonly accountSignups = new Map<string, { count: number; resetAt: number }>();

  constructor(options: AuthServiceOptions) {
    this.prisma = options.prisma;
    this.appPassword = options.appPassword;
    this.oauth = options.oauth ?? { enabled: false, providers: [] };
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
    this.accountSignups.delete(input.ip);
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
   *
   * `deviceCredentialId` links the session to the device it was minted from
   * (spec 36). It is the anchor for "one session per device": the link is
   * server-generated, so a client cannot point a session at somebody else's
   * credential.
   */
  async createProfileSession(
    profileId: number,
    via: AuthVia,
    meta: SessionMetadata,
    options: { deviceCredentialId?: string | null; deviceLabel?: string | null } = {},
  ): Promise<LoginResult> {
    const profile = await this.prisma.profile.findUnique({ where: { id: profileId } });
    if (!profile) throw new AuthFailure(404, "not_found");
    if (profile.disabled) throw new AuthFailure(403, "account_disabled");
    await this.prisma.profile.update({
      where: { id: profileId },
      data: { lastActiveAt: this.now() },
    });
    return this.createSession(profileId, via, meta, options);
  }

  /**
   * Create a device-bound secret. Only its hash is stored by the server.
   *
   * Spec 36: a device that reports an id it has already used **rotates** its
   * credential rather than getting a second one. Two credentials for one phone
   * is what made the "signed-in devices" list grow every time the phone
   * re-enrolled -- which is what happened after the Keystore key was
   * invalidated and the phone had to be set up again.
   *
   * The rotation replaces the secret, so the previous one stops working. The
   * caller is already signed in as the profile, and it could have revoked the
   * credential outright, so handing the phone a fresh secret for it gives it
   * nothing it did not already have.
   */
  async createDeviceCredential(
    profileId: number,
    label: string | null,
    deviceId?: string | null,
  ) {
    const profile = await this.prisma.profile.findUnique({ where: { id: profileId } });
    if (!profile) throw new AuthFailure(404, "not_found");
    if (profile.disabled) throw new AuthFailure(403, "account_disabled");
    const secret = randomBytes(32).toString("base64url");
    const trimmedDeviceId = deviceId?.trim() || null;

    if (trimmedDeviceId) {
      const existing = await this.prisma.deviceCredential.findFirst({
        where: { profileId, deviceId: trimmedDeviceId, revokedAt: null },
        orderBy: { createdAt: "desc" },
      });
      if (existing) {
        const rotated = await this.prisma.deviceCredential.update({
          where: { id: existing.id },
          data: {
            secretHash: hashSessionToken(secret),
            label: label?.trim() || existing.label,
            lastUsedAt: this.now(),
          },
        });
        return {
          id: rotated.id,
          secret,
          label: rotated.label,
          deviceId: rotated.deviceId,
          expiresAt: rotated.expiresAt,
        };
      }
    }

    const created = await this.prisma.deviceCredential.create({
      data: {
        id: randomUUID(), profileId, secretHash: hashSessionToken(secret),
        label: label?.trim() || null,
        deviceId: trimmedDeviceId,
        expiresAt: new Date(this.now().getTime() + 90 * 24 * 60 * 60 * 1000),
      },
    });
    return {
      id: created.id,
      secret,
      label: created.label,
      deviceId: created.deviceId,
      expiresAt: created.expiresAt,
    };
  }

  /**
   * Exchange a device secret for a session.
   *
   * Spec 36: a session belongs to a **device**, not to a sign-in. The first
   * exchange creates the session; every later one rotates the token on the
   * session the device already holds, so a phone that signs in fifty times is
   * still one row in the "Signed-in devices" panel.
   *
   * The rotation is not optional. Only the hash of a token is stored, so the
   * old token cannot be re-issued -- it is replaced, and it stops validating
   * immediately.
   */
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

    const existing = await this.prisma.session.findFirst({
      where: {
        profileId: credential.profileId,
        deviceCredentialId: credential.id,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { lastUsedAt: "desc" },
    });
    if (existing) return this.rotateSession(existing, credential, meta);

    return this.createProfileSession(credential.profileId, "device", meta, {
      deviceCredentialId: credential.id,
      deviceLabel: credential.label ?? meta.deviceLabel ?? null,
    });
  }

  /**
   * Issue a fresh token for a session the device already holds.
   *
   * The row keeps its id and its creation date, so the panel's "first signed
   * in" date stays the truth, and the 90-day cap is still measured from that
   * first sign-in.
   */
  private async rotateSession(
    session: Session,
    credential: DeviceCredential,
    meta: SessionMetadata,
  ): Promise<LoginResult> {
    const token = newSessionToken();
    const now = this.now();
    const updated = await this.prisma.session.update({
      where: { id: session.id },
      data: {
        tokenHash: hashSessionToken(token),
        lastUsedAt: now,
        expiresAt: sessionExpiry(now, session.createdAt),
        userAgent: meta.userAgent?.slice(0, 500) ?? session.userAgent,
        deviceLabel: credential.label?.trim() || session.deviceLabel,
      },
    });
    const profile = await this.prisma.profile.findUnique({
      where: { id: credential.profileId },
    });
    return {
      token,
      session: updated,
      profile,
      role: profile?.role === "admin" ? "admin" : profile ? "member" : "admin",
    };
  }

  async listDeviceCredentials(profileId: number) {
    return this.prisma.deviceCredential.findMany({
      where: { profileId, revokedAt: null }, orderBy: { createdAt: "asc" },
      select: {
        id: true,
        label: true,
        deviceId: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
      },
    });
  }

  async revokeDeviceCredential(profileId: number, id: string): Promise<void> {
    const result = await this.prisma.deviceCredential.updateMany({
      where: { id, profileId, revokedAt: null }, data: { revokedAt: this.now() },
    });
    if (!result.count) throw new AuthFailure(404, "device_not_found");
    // A revoked credential must not leave a live session behind: the session
    // is useless without the secret that minted it, and the session is what
    // the panel lists.
    await this.prisma.session.updateMany({
      where: { profileId, deviceCredentialId: id, revokedAt: null },
      data: { revokedAt: this.now() },
    });
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

  /**
   * The caller's signed-in **devices**.
   *
   * Spec 36: the panel used to list sign-ins, so one phone appeared once per
   * launch. It now lists devices. A device is a device credential (Android) or
   * a browser session (web), and the entry says how many live sessions it
   * holds -- which is one, except for rows that predate this spec.
   */
  async listDevices(context: AuthContext): Promise<DeviceSession[]> {
    if (!context.profile) return [];
    const now = this.now();
    const rows = await this.prisma.session.findMany({
      where: { profileId: context.profile.id, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { lastUsedAt: "desc" },
      include: { deviceCredential: true },
    });

    const devices = new Map<string, DeviceSession>();
    for (const row of rows) {
      const key = row.deviceCredentialId ?? row.id;
      const existing = devices.get(key);
      if (existing) {
        existing.sessions += 1;
        if (row.createdAt < existing.createdAt) existing.createdAt = row.createdAt;
        if (row.lastUsedAt > existing.lastActiveAt) existing.lastActiveAt = row.lastUsedAt;
        if (row.id === context.session.id) existing.current = true;
        continue;
      }
      devices.set(key, {
        key,
        label: row.deviceCredential?.label?.trim() || row.deviceLabel,
        userAgent: row.userAgent,
        deviceId: row.deviceCredential?.deviceId ?? null,
        via: row.via,
        createdAt: row.createdAt,
        lastActiveAt: row.lastUsedAt,
        current: row.id === context.session.id,
        sessions: 1,
      });
    }
    return [...devices.values()];
  }

  /**
   * Sign a device out: revoke every session it holds.
   *
   * The key is the device credential's id for an Android device, or the
   * session id for a browser. Both are resolved against the calling profile,
   * so a member cannot sign out somebody else's device by guessing a key.
   */
  async revokeDeviceSessions(context: AuthContext, key: string): Promise<number> {
    const profileId = context.profile?.id;
    if (!profileId) throw new AuthFailure(404, "session_not_found");
    const now = this.now();

    const credential = await this.prisma.deviceCredential.findFirst({
      where: { id: key, profileId },
      select: { id: true },
    });
    if (credential) {
      const revoked = await this.prisma.session.updateMany({
        where: { profileId, deviceCredentialId: credential.id, revokedAt: null },
        data: { revokedAt: now },
      });
      return revoked.count;
    }

    const session = await this.prisma.session.findFirst({
      where: { id: key, profileId },
      select: { id: true },
    });
    if (!session) throw new AuthFailure(404, "session_not_found");
    await this.prisma.session.update({ where: { id: session.id }, data: { revokedAt: now } });
    return 1;
  }

  /**
   * Sign every other device out, leaving the caller's own session alone.
   *
   * This is the cleanup for a household that already has the pile: one action
   * instead of one click per row.
   */
  async revokeOtherSessions(context: AuthContext): Promise<number> {
    const profileId = context.profile?.id;
    if (!profileId) throw new AuthFailure(404, "session_not_found");
    const revoked = await this.prisma.session.updateMany({
      where: { profileId, revokedAt: null, id: { not: context.session.id } },
      data: { revokedAt: this.now() },
    });
    return revoked.count;
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

  private async createSession(
    profileId: number | null,
    via: AuthVia,
    meta: SessionMetadata,
    options: { deviceCredentialId?: string | null; deviceLabel?: string | null } = {},
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
        deviceLabel: (options.deviceLabel ?? meta.deviceLabel)?.slice(0, 100) ?? null,
        deviceCredentialId: options.deviceCredentialId ?? null,
        createdAt: now,
        lastUsedAt: now,
        expiresAt: sessionExpiry(now, now),
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

  /** Per-IP ceiling on failed external sign-in attempts before throttling (spec 32). */
  private checkOAuthRate(ip: string): void {
    const entry = this.oauthFailures.get(ip);
    if (!entry) return;
    const now = this.now().getTime();
    if (now >= entry.resetAt) {
      this.oauthFailures.delete(ip);
      return;
    }
    if (entry.count >= OAUTH_MAX_ATTEMPTS) {
      throw new AuthFailure(429, "oauth_rate_limited", {
        retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000),
      });
    }
  }

  private recordOAuthFailure(ip: string): void {
    const now = this.now().getTime();
    const entry = this.oauthFailures.get(ip);
    if (!entry || now >= entry.resetAt) {
      this.oauthFailures.set(ip, { count: 1, resetAt: now + IP_WINDOW_MS });
      return;
    }
    entry.count += 1;
  }

  private clearOAuthRate(ip: string): void {
    this.oauthFailures.delete(ip);
  }

  private checkSignupRate(ip: string): void {
    const entry = this.accountSignups.get(ip);
    if (!entry) return;
    const now = this.now().getTime();
    if (now >= entry.resetAt) {
      this.accountSignups.delete(ip);
      return;
    }
    if (entry.count >= 5) {
      throw new AuthFailure(429, "oauth_rate_limited", {
        retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000),
      });
    }
  }

  private recordSignupFailure(ip: string): void {
    const now = this.now().getTime();
    const entry = this.accountSignups.get(ip);
    if (!entry || now >= entry.resetAt) this.accountSignups.set(ip, { count: 1, resetAt: now + IP_WINDOW_MS });
    else entry.count += 1;
  }
}
