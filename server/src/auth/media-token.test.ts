import { describe, expect, it } from "vitest";
import {
  issueMediaToken,
  mediaResourceFromPath,
  MEDIA_TOKEN_TTL_MS,
  verifyMediaToken,
} from "./media-token";

const secret = "0123456789abcdef0123456789abcdef";
const now = 1_800_000_000_000;

describe("short-lived media tokens", () => {
  it("binds a token to a profile and one resource until its five-minute expiry", () => {
    const token = issueMediaToken(secret, { profileId: 12, kind: "track-stream", resourceId: 77 }, now);
    expect(verifyMediaToken(secret, token, { kind: "track-stream", resourceId: 77 }, now + MEDIA_TOKEN_TTL_MS - 1))
      .toMatchObject({ profileId: 12, kind: "track-stream", resourceId: 77 });
    expect(verifyMediaToken(secret, token, { kind: "cover", resourceId: 77 }, now)).toBeNull();
    expect(verifyMediaToken(secret, token, { kind: "track-stream", resourceId: 78 }, now)).toBeNull();
    expect(verifyMediaToken(secret, token, { kind: "track-stream", resourceId: 77 }, now + MEDIA_TOKEN_TTL_MS)).toBeNull();
  });

  it("rejects tampering, malformed tokens and short signing secrets", () => {
    const token = issueMediaToken(secret, { profileId: 12, kind: "cover", resourceId: 7 }, now);
    const [payload, sig] = token.split(".");
    const changedSignature = `${sig[0] === "A" ? "B" : "A"}${sig.slice(1)}`;
    expect(verifyMediaToken(secret, `${payload}.${changedSignature}`, { kind: "cover", resourceId: 7 }, now)).toBeNull();
    expect(verifyMediaToken(secret, "not-a-token", { kind: "cover", resourceId: 7 }, now)).toBeNull();
    expect(verifyMediaToken("short", token, { kind: "cover", resourceId: 7 }, now)).toBeNull();
    expect(() => issueMediaToken("short", { profileId: 12, kind: "cover", resourceId: 7 }, now)).toThrow();
  });

  it("maps only media route paths to a resource scope", () => {
    expect(mediaResourceFromPath("/api/audiobooks/7/cover")).toEqual({ kind: "cover", resourceId: 7 });
    expect(mediaResourceFromPath("/api/audiobooks/8/stream")).toEqual({ kind: "book-stream", resourceId: 8 });
    expect(mediaResourceFromPath("/api/tracks/9/stream")).toEqual({ kind: "track-stream", resourceId: 9 });
    expect(mediaResourceFromPath("/api/audiobooks/7")).toBeNull();
    expect(mediaResourceFromPath("/api/audiobooks/0/cover")).toBeNull();
  });
});
