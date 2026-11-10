import type { PrismaClient, Profile, Session } from "@prisma/client";
import {
  SESSION_MAX_AGE_MS,
  SESSION_RENEW_WINDOW_MS,
  SESSION_TOUCH_MS,
  SESSION_TTL_MS,
  hashSessionToken,
  newSessionId,
  newSessionToken,
} from "./session";
import type { AuthContext, AuthRole, AuthVia, LoginResult, SessionMetadata } from "./service-types";

export interface SessionManagerOptions {
  prisma: PrismaClient;
  now?: () => Date;
}

export class SessionManager {
  private readonly prisma: PrismaClient;
  private readonly now: () => Date;

  constructor(options: SessionManagerOptions) {
    this.prisma = options.prisma;
    this.now = options.now ?? (() => new Date());
  }

  async createSession(
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

  async revokeSession(profileId: number, sessionId: string): Promise<boolean> {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, profileId },
      select: { id: true },
    });
    if (!session) return false;
    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: this.now() },
    });
    return true;
  }

  /** Create a session for a profile that has already proved itself (WebAuthn, device credential). */
  async createProfileSession(
    profileId: number,
    via: AuthVia,
    meta: SessionMetadata,
  ): Promise<LoginResult> {
    const profile = await this.prisma.profile.findUnique({ where: { id: profileId } });
    if (!profile) throw new Error("Profile not found");
    if (profile.disabled) throw new Error("Account disabled");
    await this.prisma.profile.update({
      where: { id: profileId },
      data: { lastActiveAt: this.now() },
    });
    return this.createSession(profileId, via, meta);
  }
}
