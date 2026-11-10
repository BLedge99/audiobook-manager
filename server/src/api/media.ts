import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { PrismaClient } from "@prisma/client";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { fail } from "../http-errors";
import { libraryEntriesFor } from "../library-membership";
import { issueMediaToken } from "../auth/media-token";
import { resolveInsideRoot } from "../safePath";

export interface MediaRoutesOptions {
  prisma: PrismaClient;
  authEnabled: boolean;
  mediaTokenSecret: string | undefined;
  accountExperience: "household" | "demo";
  optionalProfileId: (request: FastifyRequest) => number | null;
  requireAccountProfileId: (request: FastifyRequest, reply: FastifyReply) => number | null;
  parseIdParam: (raw: string | undefined) => number | null;
  canReadMediaItem: (request: FastifyRequest, mediaItemId: number) => Promise<boolean>;
}

/**
 * Media token and audio streaming routes.
 *
 * Covers and streams are both gated by the same membership check the rest of
 * the library uses: a token is only minted for a resource the caller may read,
 * and the stream route re-checks before opening the file.
 */
export function registerMediaRoutes(app: FastifyInstance, options: MediaRoutesOptions): void {
  const { prisma, authEnabled, mediaTokenSecret, accountExperience, optionalProfileId, requireAccountProfileId, parseIdParam, canReadMediaItem } = options;

  app.post<{ Body: { kind: "cover" | "book-stream" | "track-stream"; id: number } }>("/api/auth/media-token", {
    schema: {
      body: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["cover", "book-stream", "track-stream"] },
          id: { type: "integer", minimum: 1 },
        },
        required: ["kind", "id"],
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    // Development without APP_PASSWORD intentionally has no auth boundary and
    // therefore needs no bearer token on media URLs.
    if (!authEnabled) return { token: null, expiresAt: null };
    const profileId = accountExperience === "demo"
      ? requireAccountProfileId(request, reply)
      : optionalProfileId(request);
    if (profileId === null) {
      return accountExperience === "demo" && reply.sent ? undefined : fail(reply, accountExperience === "demo" ? 401 : 400, accountExperience === "demo" ? "auth_required" : "profile_required");
    }
    if (!mediaTokenSecret || Buffer.byteLength(mediaTokenSecret, "utf8") < 32) {
      return fail(reply, 503, "media_token_not_configured");
    }

    const { kind, id } = request.body;
    const allowed = kind === "track-stream"
      ? await prisma.track.findFirst({
        where: { id, mediaItem: libraryEntriesFor(profileId) },
        select: { id: true },
      })
      : await prisma.mediaItem.findFirst({
        where: { id, ...libraryEntriesFor(profileId) },
        select: { id: true },
      });
    if (!allowed) return fail(reply, 404, kind === "track-stream" ? "track_not_found" : "audiobook_not_found");

    const token = issueMediaToken(mediaTokenSecret, { profileId, kind, resourceId: id });
    reply.header("cache-control", "no-store");
    return { token, expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() };
  });

  app.get<{ Params: { id: string } }>("/api/audiobooks/:id/stream", async (request, reply) => {
    const item = await prisma.mediaItem.findUnique({
      where: { id: parseIdParam(request.params.id) ?? -1 },
      include: { libraryRoot: true },
    });
    if (!item) return fail(reply, 404, "audiobook_not_found");
    if (!(await canReadMediaItem(request, item.id))) return fail(reply, 404, "audiobook_not_found");
    if (resolveInsideRoot(item.filePath, item.libraryRoot.path) === null) {
      return fail(reply, 403, "forbidden");
    }
    try {
      return await streamAudioFile(item.filePath, request.headers.range, reply);
    } catch {
      return fail(reply, 404, "audio_file_not_found");
    }
  });

  app.get<{ Params: { id: string } }>("/api/tracks/:id/stream", async (request, reply) => {
    const id = parseIdParam(request.params.id);
    if (id === null) return fail(reply, 400, "invalid_id");
    if (!Number.isInteger(id) || id < 1) return fail(reply, 400, "invalid_track_id");
    const track = await prisma.track.findUnique({
      where: { id },
      include: { mediaItem: { include: { libraryRoot: true } } },
    });
    if (!track) return fail(reply, 404, "track_not_found");
    if (!(await canReadMediaItem(request, track.mediaItem.id))) return fail(reply, 404, "track_not_found");
    if (resolveInsideRoot(track.filePath, track.mediaItem.libraryRoot.path) === null) {
      return fail(reply, 403, "forbidden");
    }
    try {
      return await streamAudioFile(track.filePath, request.headers.range, reply);
    } catch {
      return fail(reply, 404, "audio_file_not_found");
    }
  });
}

async function streamAudioFile(filePath: string, range: string | undefined, reply: import("fastify").FastifyReply) {
  const details = await stat(filePath);
  reply.header("Accept-Ranges", "bytes").type("audio/mpeg");
  if (!range) {
    reply.header("Content-Length", details.size);
    return reply.send(createReadStream(filePath));
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) return reply.code(416).header("Content-Range", `bytes */${details.size}`).send();
  const start = match[1] ? Number(match[1]) : Math.max(0, details.size - Number(match[2]));
  const end = match[1] && match[2] ? Number(match[2]) : match[1] ? details.size - 1 : details.size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= details.size || start > end) {
    return reply.code(416).header("Content-Range", `bytes */${details.size}`).send();
  }
  const boundedEnd = Math.min(end, details.size - 1);
  reply.code(206).headers({ "Content-Range": `bytes ${start}-${boundedEnd}/${details.size}`, "Content-Length": boundedEnd - start + 1 });
  return reply.send(createReadStream(filePath, { start, end: boundedEnd }));
}
