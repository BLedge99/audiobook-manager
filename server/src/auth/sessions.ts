/**
 * The sessions and devices concern (spec 37, candidate 4, pilot).
 *
 * Everything about "who holds a live session, on which device, and how they
 * lost it": profile sessions, device credentials, the exchange/rotation,
 * validation of the per-request token, the signed-in-devices panel and the
 * revoke paths. `service.ts` (the facade) delegates here so the rules have
 * one home; nothing else may mint, rotate or forget a session.
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { DeviceCredential, PrismaClient, Session } from "@prisma/client";
import {
  SESSION_MAX_AGE_MS,
  SESSION_RENEW_WINDOW_MS,
  SESSION_TOUCH_MS,
  SESSION_TTL_MS,
  hashSessionToken,
  newSessionToken,
  sessionExpiry,
} from "./session";
import {
  SESSION_PROFILE_SELECT,
  createSessionCore,
  AuthFailure,
  type AuthContext,
  type AuthRole,
  type AuthVia,
  type DeviceSession,
  type LoginResult,
  type SessionMetadata,
} from "./internal";

export interface SessionsServiceOptions {
  prisma: PrismaClient;
  /** Test seam for expiry and lockout. */
  now?: () => Date;
}

export class SessionsService {
  private readonly prisma: PrismaClient;
  private readonly now: () => Date;

  constructor(options: SessionsServiceOptions) {
    this.prisma = options.prisma;
    this.now = options.now ?? (() => new Date());
  }

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
    return createSessionCore(this.prisma, this.now, profileId, via, meta, options);
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
      include: { profile: { select: SESSION_PROFILE_SELECT } },
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

    const role: AuthRole = session.profile?.role === "admin" ? "admin" : session.profile?.role === "child" ? "child" : session.profile ? "member" : "admin";
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
}
