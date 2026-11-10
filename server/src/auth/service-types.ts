import type { Session, Profile } from "@prisma/client";
import type { ApiErrorCode, ApiErrorParams } from "../http-errors";
import type { OAuthConfig } from "./oauth";

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
  prisma: any;
  appPassword?: string;
  /** External OAuth providers for the production demo (spec 32 / ADR 023). */
  oauth?: OAuthConfig;
  /** Test seam for expiry and lockout. */
  now?: () => Date;
}
