import { createHash, randomBytes } from "node:crypto";
import type { FastifyRequest } from "fastify";

/** The cookie the browser/PWA uses. The Android app uses the header instead. */
export const SESSION_COOKIE = "house_session";
export const SESSION_HEADER = "x-house-session";

/** 30 days, sliding while in use. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Hard cap from creation; sliding must not make a session immortal. */
export const SESSION_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
/** Do not write lastUsedAt on every request. */
export const SESSION_TOUCH_MS = 60 * 60 * 1000;
/** Extend only when the session is this close to expiry. */
export const SESSION_RENEW_WINDOW_MS = 20 * 24 * 60 * 60 * 1000;

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function newSessionId(): string {
  return randomBytes(12).toString("hex");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Store a useful, non-identifying device label beside the raw user agent. */
export function deviceLabelFromUserAgent(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  if (/android/i.test(userAgent)) return "Android device";
  if (/iphone|ipad|ipod/i.test(userAgent)) return "Apple mobile device";
  if (/windows/i.test(userAgent)) return "Windows device";
  if (/macintosh|mac os/i.test(userAgent)) return "Mac device";
  if (/linux/i.test(userAgent)) return "Linux device";
  return null;
}

/**
 * Read the token from the sources the app actually uses:
 *
 *  - the cookie for the web/PWA;
 *  - `x-house-session` for the Android WebView, which cannot use a SameSite
 *    cookie across schemes;
 *  - `<audio>` and `<img>` requests use short-lived media tokens instead of
 *    exposing this session token in a URL.
 */
export function sessionTokenFromRequest(request: FastifyRequest): string | null {
  const header = request.headers[SESSION_HEADER];
  if (typeof header === "string" && header.length > 0) return header;

  const cookie = request.cookies?.[SESSION_COOKIE];
  return typeof cookie === "string" && cookie.length > 0 ? cookie : null;
}
