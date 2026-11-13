/**
 * BigInt-safe payload preparation. Prisma returns BigInt columns
 * (Track.sizeBytes) and a bare JSON.stringify throws on them. The old
 * implementation went JSON.stringify -> JSON.parse over the whole payload,
 * twice per response, to coerce BigInts. This walks the tree once and
 * converts in place; payloads are built per request and never reused.
 */
export function serializeBigInts<T>(value: T): T {
  return walk(value) as T;
}

function walk(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) value[i] = walk(value[i]);
    return value;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) record[key] = walk(record[key]);
    return value;
  }
  return value;
}
