import { createHmac, timingSafeEqual } from "node:crypto";

export const MEDIA_TOKEN_TTL_MS = 5 * 60 * 1000;

export type MediaResourceKind = "cover" | "book-stream" | "track-stream";

export interface MediaTokenClaims {
  profileId: number;
  kind: MediaResourceKind;
  resourceId: number;
  expiresAt: number;
}

function signature(secret: string, encoded: string): Buffer {
  return createHmac("sha256", secret).update(encoded).digest();
}

export function issueMediaToken(
  secret: string,
  claims: Omit<MediaTokenClaims, "expiresAt">,
  now = Date.now(),
): string {
  if (Buffer.byteLength(secret, "utf8") < 32) throw new Error("MEDIA_TOKEN_SECRET must contain at least 32 bytes");
  const encoded = Buffer.from(JSON.stringify({ ...claims, expiresAt: now + MEDIA_TOKEN_TTL_MS })).toString("base64url");
  return `${encoded}.${signature(secret, encoded).toString("base64url")}`;
}

export function verifyMediaToken(
  secret: string | undefined,
  token: unknown,
  expected: Pick<MediaTokenClaims, "kind" | "resourceId">,
  now = Date.now(),
): MediaTokenClaims | null {
  if (!secret || Buffer.byteLength(secret, "utf8") < 32 || typeof token !== "string" || token.length > 1024) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  let actual: Buffer;
  let payload: unknown;
  try {
    actual = Buffer.from(parts[1], "base64url");
    const expectedSignature = signature(secret, parts[0]);
    if (actual.length !== expectedSignature.length || !timingSafeEqual(actual, expectedSignature)) return null;
    payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null) return null;
  const claims = payload as Partial<MediaTokenClaims>;
  if (
    !Number.isSafeInteger(claims.profileId) || (claims.profileId ?? 0) < 1 ||
    claims.kind !== expected.kind || claims.resourceId !== expected.resourceId ||
    !Number.isSafeInteger(claims.expiresAt) || (claims.expiresAt ?? 0) <= now ||
    (claims.expiresAt ?? 0) > now + MEDIA_TOKEN_TTL_MS + 5_000
  ) return null;
  return claims as MediaTokenClaims;
}

export function mediaResourceFromPath(path: string): Pick<MediaTokenClaims, "kind" | "resourceId"> | null {
  const match = /^\/api\/(?:audiobooks\/(\d+)\/(cover|stream)|tracks\/(\d+)\/stream)$/.exec(path);
  if (!match) return null;
  const resourceId = Number(match[1] ?? match[3]);
  if (!Number.isSafeInteger(resourceId) || resourceId < 1) return null;
  const kind: MediaResourceKind = match[2] === "cover"
    ? "cover"
    : match[2] === "stream" ? "book-stream" : "track-stream";
  return { kind, resourceId };
}
