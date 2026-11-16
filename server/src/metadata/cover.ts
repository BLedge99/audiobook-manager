import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { promises as dns } from "node:dns";
import { Readable } from "node:stream";

/**
 * Cover download, hardened against server-side request forgery.
 *
 * Two layers of protection:
 *
 * 1. URL validation before connecting (and on every redirect hop): scheme must be
 *    http(s); literal IP hosts (IPv4 in any spelling the WHATWG parser normalises,
 *    bracketed IPv6 including IPv4-mapped forms) must be globally reachable; named
 *    hosts are resolved via DNS and every answer must be a public address.
 * 2. Content validation before writing: size is enforced while streaming (not after
 *    buffering), the content-type (when present) must be an allowed image type, and
 *    the leading bytes must match JPEG/PNG/WEBP magic numbers.
 */

export const COVER_DIR = process.env.COVER_DIR || "/app/data/covers";

/** 8 MB. Provider covers are at most a few hundred KB; anything larger is a bug or an attack. */
export const MAX_COVER_BYTES = 8 * 1024 * 1024;

const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const MAX_REDIRECTS = 5;

/** The scheme we will follow. Anything else (file:, gopher:, ...) is refused. */
function isFetchableUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** Parse a dotted-quad IPv4 literal into octets; null if not one. */
function parseIPv4(host: string): number[] | null {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return null;
  const octets = match.slice(1).map(Number);
  return octets.some((octet) => octet > 255) ? null : octets;
}

function isPrivateIPv4(octets: number[]): boolean {
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true; // unspecified, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  return false;
}

/**
 * Parse an IPv6 literal (with or without surrounding brackets) into eight 16-bit
 * groups; null if not one. Handles "::" compression and an embedded dotted-quad
 * tail (e.g. "::ffff:127.0.0.1"). WHATWG parsing normalises the IPv4 part of
 * IPv4-mapped addresses to hex groups, so both spellings are accepted here.
 */
function parseIPv6(host: string): number[] | null {
  let address = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (!address.includes(":")) return null;

  const lastPart = address.split(":").at(-1) ?? "";
  if (lastPart.includes(".")) {
    const embedded = parseIPv4(lastPart);
    if (!embedded) return null;
    const hi = ((embedded[0] << 8) | embedded[1]).toString(16);
    const lo = ((embedded[2] << 8) | embedded[3]).toString(16);
    address = `${address.slice(0, address.length - lastPart.length)}${hi}:${lo}`;
  }

  const halves = address.split("::");
  if (halves.length > 2) return null;
  const isGroup = (group: string) => /^[0-9a-fA-F]{1,4}$/.test(group);
  const left = halves[0] === "" ? [] : halves[0].split(":");
  const right = halves.length === 2 ? (halves[1] === "" ? [] : halves[1].split(":")) : null;
  if (right === null) {
    // No "::" — must be exactly eight groups.
    if (left.length !== 8 || !left.every(isGroup)) return null;
    return left.map((group) => parseInt(group, 16));
  }
  if (!left.every(isGroup) || !right.every(isGroup)) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;
  return [...left, ...Array<string>(missing).fill("0"), ...right].map((group) => parseInt(group, 16));
}

function isPrivateIPv6(groups: number[]): boolean {
  const allZero = groups.every((group) => group === 0);
  if (allZero) return true; // unspecified ::
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return true; // ::1 loopback
  if ((groups[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((groups[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((groups[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  // IPv4-mapped ::ffff:0:0/96 — apply the IPv4 rules to the embedded address.
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return isPrivateIPv4([groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff]);
  }
  return false;
}

function isLiteralIp(host: string): boolean {
  return parseIPv4(host) !== null || parseIPv6(host) !== null;
}

function isPublicAddress(address: string): boolean {
  const v4 = parseIPv4(address);
  if (v4) return !isPrivateIPv4(v4);
  const v6 = parseIPv6(address);
  if (v6) return !isPrivateIPv6(v6);
  return false;
}

/**
 * Reject URLs that resolve to private/loopback/link-local addresses. Provider
 * covers legitimately live on public CDNs; anything targeting the host's own
 * network is not a cover. Literal IP hosts are checked without DNS; named hosts
 * are resolved and every answer must be public. (DNS is checked per redirect hop;
 * a re-resolved answer differing between check and connect — rebinding — is out
 * of scope for this guard and is noted in LIMITATIONS.)
 */
export function isPublicCoverUrl(raw: string): boolean {
  if (!isFetchableUrl(raw)) return false;
  let host = new URL(raw).hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) {
    const groups = parseIPv6(host);
    return groups !== null && !isPrivateIPv6(groups);
  }
  host = host.replace(/\.+$/, ""); // trailing-dot spellings, e.g. "localhost."
  if (host === "" || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return false;
  }
  const ipv4 = parseIPv4(host);
  if (ipv4) return !isPrivateIPv4(ipv4);
  return true;
}

export interface CoverDownloadResult {
  ok: boolean;
  path?: string;
  reason?: string;
}

export type DnsLookup = (host: string) => Promise<Array<{ address: string; family: number }>>;

const defaultLookup: DnsLookup = (host) => dns.lookup(host, { all: true, verbatim: true });

async function resolvesPublicly(host: string, lookup: DnsLookup): Promise<boolean> {
  try {
    const answers = await lookup(host);
    if (!answers || answers.length === 0) return false;
    return answers.every(({ address }) => isPublicAddress(address));
  } catch {
    return false;
  }
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function sniffImageType(buffer: Buffer): "jpeg" | "png" | "webp" | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer.readUInt32BE(0) === 0x89504e47 &&
    buffer.readUInt32BE(4) === 0x0d0a1a0a
  ) {
    return "png";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("latin1", 0, 4) === "RIFF" &&
    buffer.toString("latin1", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

/**
 * Download a cover into the app's covers directory.
 *
 * Writes only under `COVER_DIR` — never to a library root. Redirects are followed
 * manually and every hop is re-validated (scheme, literal IP ranges, DNS answers),
 * so a CDN cannot bounce the fetch onto the host's own network. The body is
 * streamed with a byte counter and aborted past `maxBytes` — memory use stays
 * bounded regardless of what the server sends.
 */
export async function fetchCover(
  rawUrl: string,
  filename: string,
  options: { timeoutMs?: number; maxBytes?: number; dir?: string; lookup?: DnsLookup } = {},
): Promise<CoverDownloadResult> {
  if (!isPublicCoverUrl(rawUrl)) return { ok: false, reason: "untrusted-cover-url" };

  const lookup = options.lookup ?? defaultLookup;
  const dir = options.dir ?? COVER_DIR;
  const maxBytes = options.maxBytes ?? MAX_COVER_BYTES;

  try {
    let url = rawUrl;
    let res: Response | null = null;
    for (let hop = 0; ; hop += 1) {
      const host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
      if (!isLiteralIp(host)) {
        if (!(await resolvesPublicly(host, lookup))) {
          return { ok: false, reason: "dns-untrusted" };
        }
      }
      res = await fetch(url, {
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
        redirect: "manual",
      });
      if (!isRedirect(res.status)) break;
      if (hop >= MAX_REDIRECTS) {
        return { ok: false, reason: "too-many-redirects" };
      }
      const location = res.headers.get("location");
      if (!location) return { ok: false, reason: "redirect-no-location" };
      const next = new URL(location, url).toString();
      if (!isPublicCoverUrl(next)) return { ok: false, reason: "untrusted-redirect" };
      url = next;
    }

    if (!res.ok) return { ok: false, reason: `http-${res.status}` };

    const contentType = (res.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
    if (contentType && !ALLOWED_CONTENT_TYPES.has(contentType)) {
      return { ok: false, reason: `unsupported-content-type-${contentType || "unknown"}` };
    }

    const declaredLength = Number(res.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      return { ok: false, reason: "too-large" };
    }

    if (!res.body) return { ok: false, reason: "fetch-failed" };
    const stream = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      total += buffer.length;
      if (total > maxBytes) {
        stream.destroy();
        return { ok: false, reason: "too-large" };
      }
      chunks.push(buffer);
    }
    const buffer = Buffer.concat(chunks);
    if (buffer.byteLength === 0) return { ok: false, reason: "empty-body" };

    // Some CDNs serve HTML error pages as image/jpeg: the magic bytes decide.
    if (sniffImageType(buffer) === null) return { ok: false, reason: "not-an-image" };

    await mkdir(dir, { recursive: true });
    // Filename is generated by us, but keep it a single path segment regardless.
    const safeName = path.basename(filename);
    const destPath = path.join(dir, safeName);
    await writeFile(destPath, buffer);
    return { ok: true, path: destPath };
  } catch {
    return { ok: false, reason: "fetch-failed" };
  }
}

/** Deterministic-ish unique filename for a candidate cover. */
export function coverFilename(source: string, identifier: string | number): string {
  const safe = String(identifier).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
  return `${source}_${safe}.jpg`;
}
