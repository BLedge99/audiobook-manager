/**
 * Shared guts for the auth concern modules (spec 37, candidate 4).
 *
 * Everything both `service.ts` (the facade) and `sessions.ts` (the sessions
 * and devices concern) need, in one import — the create-session core, the
 * session-facing profile select, the shared types and the failure type.
 * Nothing here knows about rate limiters, lockouts or HTTP; those stay in
 * the concern modules that actually use them.
 */
import type { Prisma, PrismaClient, Profile, Session } from "@prisma/client";
import type { ApiErrorCode, ApiErrorParams } from "../http-errors";
import {
  hashSessionToken,
  newSessionId,
  newSessionToken,
  sessionExpiry,
} from "./session";

export type AuthRole = "admin" | "member" | "child";
export type AuthVia = "profile" | "household" | "device" | "oauth";

/** The session-facing profile: the full account row minus the password hash. */
export type SessionProfile = Omit<Profile, "passwordHash">;

/**
 * What `validate()` pulls per request. Every Profile column except
 * `passwordHash`, which no request-path consumer reads — loading it per
 * authenticated request was pure exposure of the one secret in the row.
 */
export const SESSION_PROFILE_SELECT = {
  id: true,
  name: true,
  color: true,
  createdAt: true,
  passwordUpdatedAt: true,
  role: true,
  disabled: true,
  failedLoginCount: true,
  lockedUntil: true,
  lastLoginAt: true,
  lastActiveAt: true,
  oauthProvider: true,
  oauthProviderId: true,
  email: true,
  ageBand: true,
  followsServerLibrary: true,
} satisfies Prisma.ProfileSelect;

export interface AuthContext {
  token: string;
  session: Session;
  profile: SessionProfile | null;
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

/**
 * Mint a session row and return the token. The only place sessions are
 * created; every sign-in path (household, profile, OAuth, email, device)
 * ends here.
 */
export async function createSessionCore(
  prisma: PrismaClient,
  now: () => Date,
  profileId: number | null,
  via: AuthVia,
  meta: SessionMetadata,
  options: { deviceCredentialId?: string | null; deviceLabel?: string | null } = {},
): Promise<LoginResult> {
  const token = newSessionToken();
  const created = now();
  const session = await prisma.session.create({
    data: {
      id: newSessionId(),
      tokenHash: hashSessionToken(token),
      profileId,
      via,
      userAgent: meta.userAgent?.slice(0, 500) ?? null,
      deviceLabel: (options.deviceLabel ?? meta.deviceLabel)?.slice(0, 100) ?? null,
      deviceCredentialId: options.deviceCredentialId ?? null,
      createdAt: created,
      lastUsedAt: created,
      expiresAt: sessionExpiry(created, created),
    },
  });
  const profile = profileId ? await prisma.profile.findUnique({ where: { id: profileId } }) : null;
  return {
    token,
    session,
    profile,
    role: profile?.role === "admin" ? "admin" : profile ? "member" : "admin",
  };
}
