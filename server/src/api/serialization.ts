import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export function serializeBigInts<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, nestedValue) => (
    typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue
  ))) as T;
}

export function registerSerializationHooks(app: FastifyInstance): void {
  app.addHook("preSerialization", async (_request, _reply, payload) => serializeBigInts(payload));
}

export function sendConditional<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: T,
  options: { match?: string; vary?: string[]; cacheControl?: string } = {},
): T | FastifyReply {
  const serialized = options.match ?? JSON.stringify(payload, (_key, value) => (
    typeof value === "bigint" ? value.toString() : value
  ));
  const etag = `"${createHash("sha1").update(serialized).digest("hex")}"`;
  const ifNoneMatch = request.headers["if-none-match"];
  const tags = (Array.isArray(ifNoneMatch) ? ifNoneMatch : [ifNoneMatch])
    .flatMap((value) => String(value ?? "").split(","))
    .map((value) => value.trim());

  reply.header("ETag", etag);
  reply.header("Cache-Control", options.cacheControl ?? "private, no-cache");
  if (options.vary?.length) reply.header("Vary", options.vary.join(", "));
  if (tags.some((tag) => tag === "*" || tag.replace(/^W\//, "") === etag)) {
    return reply.code(304).send();
  }
  return reply.send(payload);
}
