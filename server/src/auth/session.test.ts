import { describe, expect, it } from "vitest";
import type { FastifyRequest } from "fastify";
import {
  SESSION_COOKIE,
  SESSION_HEADER,
  SESSION_MAX_AGE_MS,
  SESSION_RENEW_WINDOW_MS,
  SESSION_TOUCH_MS,
  SESSION_TTL_MS,
  deviceLabelFromUserAgent,
  hashSessionToken,
  newSessionId,
  newSessionToken,
  sessionTokenFromRequest,
} from "./session";

function request(headers: Record<string, string>, cookies: Record<string, string> = {}) {
  return { headers, cookies } as unknown as FastifyRequest;
}

describe("session device labels", () => {
  it("maps common platform strings to concise labels without echoing the user agent", () => {
    expect(deviceLabelFromUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140"))
      .toBe("Windows device");
    expect(deviceLabelFromUserAgent("Mozilla/5.0 (Linux; Android 13; Pixel 4a) Chrome/140"))
      .toBe("Android device");
    expect(deviceLabelFromUserAgent("custom agent")).toBeNull();
    expect(deviceLabelFromUserAgent(null)).toBeNull();
  });
});

describe("session tokens", () => {
  it("are 32 random bytes in base64url, and never repeat", () => {
    const first = newSessionToken();
    const second = newSessionToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first).not.toBe(second);
  });

  it("hash deterministically to a 64-character SHA-256 digest", () => {
    const token = newSessionToken();
    expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
    expect(hashSessionToken(token)).not.toBe(hashSessionToken(newSessionToken()));
  });

  it("use a 24-character session id", () => {
    expect(newSessionId()).toMatch(/^[0-9a-f]{24}$/);
    expect(newSessionId()).not.toBe(newSessionId());
  });

  it("keep the documented lifetime, cap and touch interval", () => {
    expect(SESSION_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(SESSION_MAX_AGE_MS).toBe(90 * 24 * 60 * 60 * 1000);
    expect(SESSION_TOUCH_MS).toBe(60 * 60 * 1000);
    expect(SESSION_RENEW_WINDOW_MS).toBe(20 * 24 * 60 * 60 * 1000);
  });
});

describe("session token lookup", () => {
  it("prefers the Android header over the cookie", () => {
    expect(sessionTokenFromRequest(request(
      { [SESSION_HEADER]: "header-token" },
      { [SESSION_COOKIE]: "cookie-token" },
    ))).toBe("header-token");
  });

  it("falls back to the web cookie", () => {
    expect(sessionTokenFromRequest(request({}, { [SESSION_COOKIE]: "cookie-token" })))
      .toBe("cookie-token");
  });

  it("is null when neither is present or the header is empty", () => {
    expect(sessionTokenFromRequest(request({}))).toBeNull();
    expect(sessionTokenFromRequest(request({ [SESSION_HEADER]: "" }))).toBeNull();
  });
});

