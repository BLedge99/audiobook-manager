/**
 * The audio/image delivery surface: media-token grants, covers, book and
 * track streams. Token URLs carry short-lived bearer tokens in the query
 * string because native media requests cannot consistently carry a header.
 */
import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { COVER_DIR } from "../metadata/cover";
import { fail } from "../http-errors";
import { isDemoMode, type AccountExperience } from "../auth/demo-policy";
import { issueMediaToken } from "../auth/media-token";
import { libraryEntriesFor } from "../library-membership";
import { visibleForAge } from "../age/facts";
import { resolveInsideRoot } from "../safePath";
import { sendConditional } from "../conditional";
import type { OptionalProfileId } from "../request-context";

export interface MediaRouteDeps {
  prisma: PrismaClient;
  authEnabled: boolean;
  accountExperience: AccountExperience;
  mediaTokenSecret: string | undefined;
  parseIdParam: (raw: string | undefined) => number | null;
  optionalProfileId: OptionalProfileId;
  requireAccountProfileId: (request: FastifyRequest, reply: FastifyReply) => number | null;
  canReadMediaItem: (request: FastifyRequest, mediaItemId: number) => Promise<boolean>;
}

export async function registerMediaRoutes(
  app: FastifyInstance,
  deps: MediaRouteDeps,
): Promise<void> {
  const {
    prisma,
    authEnabled,
    accountExperience,
    mediaTokenSecret,
    parseIdParam,
    optionalProfileId,
    requireAccountProfileId,
    canReadMediaItem,
  } = deps;

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
    const profileId = isDemoMode(accountExperience)
      ? requireAccountProfileId(request, reply)
      : optionalProfileId(request);
    if (profileId === null) {
      return isDemoMode(accountExperience) && reply.sent ? undefined : fail(reply, isDemoMode(accountExperience) ? 401 : 400, isDemoMode(accountExperience) ? "auth_required" : "profile_required");
    }
    if (!mediaTokenSecret || Buffer.byteLength(mediaTokenSecret, "utf8") < 32) {
      return fail(reply, 503, "media_token_not_configured");
    }

    const { kind, id } = request.body;
    const track = kind === "track-stream"
      ? await prisma.track.findFirst({
          where: { id, mediaItem: libraryEntriesFor(profileId) },
          select: { id: true, mediaItemId: true },
        })
      : null;
    const item = kind === "track-stream"
      ? null
      : await prisma.mediaItem.findFirst({
          where: { id, ...libraryEntriesFor(profileId) },
          select: { id: true },
        });
    const allowed = kind === "track-stream" ? track !== null : item !== null;
    if (!allowed) return fail(reply, 404, kind === "track-stream" ? "track_not_found" : "audiobook_not_found");
    // Spec 38: membership is necessary, not sufficient — the age gate applies too.
    const mediaItemId = track ? track.mediaItemId : id;
    if (!(await visibleForAge(prisma, request.auth?.role, profileId, mediaItemId))) {
      return fail(reply, 404, kind === "track-stream" ? "track_not_found" : "audiobook_not_found");
    }

    const token = issueMediaToken(mediaTokenSecret, { profileId, kind, resourceId: id });
    reply.header("cache-control", "no-store");
    return { token, expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() };
  });

  app.get<{ Params: { id: string } }>("/api/audiobooks/:id/cover", async (request, reply) => {
    const item = await prisma.mediaItem.findUnique({
      where: { id: parseIdParam(request.params.id) ?? -1 },
      include: { libraryRoot: true },
    });
    if (!item?.coverImagePath) return fail(reply, 404, "cover_not_found");
    if (!(await canReadMediaItem(request, item.id))) return fail(reply, 404, "cover_not_found");
    // Covers may legitimately live in the app covers dir OR beside the media,
    // so allow both roots.
    const allowed = [item.libraryRoot.path, COVER_DIR].some((root) => resolveInsideRoot(item.coverImagePath as string, root) !== null);
    if (!allowed) return fail(reply, 403, "forbidden");
    try {
      await access(item.coverImagePath);
    } catch {
      return fail(reply, 404, "cover_not_found");
    }
    reply.type(`image/${path.extname(item.coverImagePath).slice(1) || "jpeg"}`);
    // Spec 15b feature 1 — conditional cover delivery.
    let match: string;
    try {
      const stats = await stat(item.coverImagePath);
      match = `${item.coverImagePath}:${stats.mtimeMs}:${stats.size}`;
    } catch {
      return fail(reply, 404, "cover_not_found");
    }
    // Defer opening the file until the 304 decision is known: passing an
    // open stream here opened an fd that a 304 response never consumed.
    return sendConditional(request, reply, undefined, {
      match,
      produce: () => createReadStream(item.coverImagePath as string),
    });
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

const AUDIO_CONTENT_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".m4b": "audio/mp4",
  ".m4a": "audio/mp4",
  ".mp4": "audio/mp4",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".wav": "audio/wav",
  ".aac": "audio/aac",
};

function audioContentType(filePath: string): string {
  return AUDIO_CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

async function streamAudioFile(filePath: string, range: string | undefined, reply: import("fastify").FastifyReply) {
  const details = await stat(filePath);
  // Private, hour-long cache: it is the household's own media, and repeated
  // range requests (seeking) should not revalidate every hit.
  reply.header("Accept-Ranges", "bytes").type(audioContentType(filePath)).header("cache-control", "private, max-age=3600");
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
