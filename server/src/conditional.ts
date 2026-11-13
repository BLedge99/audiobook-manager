/**
 * Conditional requests (spec 15b feature 1). `match` is what the tag hashes.
 */
import { createHash } from "node:crypto";

export function sendConditional<T>(
  request: { headers: Record<string, unknown> },
  reply: { header: (name: string, value: string) => unknown; code: (status: number) => { send: () => unknown } },
  payload: T | undefined,
  options: { match?: string; vary?: string[]; produce?: () => T } = {},
): T | unknown {
  // For JSON it is the serialised payload, deliberately: the library response
  // mixes MediaItem columns, four join tables and the *caller's own* progress,
  // and a hand-picked set of `updatedAt` columns would silently miss a genre
  // applied after the last rescan. A stream cannot be serialised at all, so
  // the cover route passes the file's mtime and size instead.
  const serialised = options.match ?? JSON.stringify(payload, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
  const tag = `"${createHash("sha1").update(serialised).digest("hex")}"`;
  reply.header("etag", tag);
  reply.header("cache-control", "private, no-cache");
  if (options.vary) reply.header("vary", options.vary.join(", "));
  // A client may send a list, and `*` matches anything. Comparing the whole
  // header as a string would miss both.
  const ifNoneMatch = request.headers["if-none-match"];
  const tags = Array.isArray(ifNoneMatch) ? ifNoneMatch : [ifNoneMatch];
  if (tags.some((value) => value === "*" || value === tag || String(value ?? "").split(",").some((entry) => entry.trim() === tag))) {
    return reply.code(304).send();
  }
  // The 304 path must not materialise a deferred payload (e.g. an open file
  // stream); callers with expensive payloads pass `produce` for that reason.
  if (options.produce) return options.produce();
  return payload;
}

export type SendConditional = typeof sendConditional;
