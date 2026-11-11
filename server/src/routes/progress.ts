/**
 * Profile-scoped playback state: saved positions, play sessions and the
 * recent-history feed the "resume" shelf reads.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { fail } from "../http-errors";

export interface ProgressRouteDeps {
  prisma: PrismaClient;
  parseIdParam: (raw: string | undefined) => number | null;
  requireProfileId: (request: FastifyRequest) => number | null;
}

export async function registerProgressRoutes(
  app: FastifyInstance,
  deps: ProgressRouteDeps,
): Promise<void> {
  const { prisma, parseIdParam, requireProfileId } = deps;

  // Progress (profile-scoped)
  app.get<{ Params: { id: string } }>("/api/audiobooks/:id/progress", {
    schema: {
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  }, async (request, reply) => {
    const profileId = requireProfileId(request);
    if (profileId === null) return fail(reply, 400, "profile_required");
    const item = await prisma.mediaItem.findUnique({ where: { id: parseIdParam(request.params.id) ?? -1 } });
    if (!item) return fail(reply, 404, "audiobook_not_found");
    const row = await prisma.listeningHistory.findFirst({
      where: { mediaItemId: item.id, profileId },
      orderBy: { lastPlayed: "desc" },
    });
    return { position: row?.position ?? 0, completed: row?.completed ?? false };
  });

  app.put<{ Params: { id: string }; Body: { position?: number; completed?: boolean } }>("/api/audiobooks/:id/progress", {
    schema: {
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      body: {
        type: "object",
        properties: {
          position: { type: "number" },
          completed: { type: "boolean" },
        },
      },
    },
  }, async (request, reply) => {
    const profileId = requireProfileId(request);
    if (profileId === null) return fail(reply, 400, "profile_required");
    const item = await prisma.mediaItem.findUnique({ where: { id: parseIdParam(request.params.id) ?? -1 } });
    if (!item) return fail(reply, 404, "audiobook_not_found");

    const rawPosition = typeof request.body?.position === "number" && Number.isFinite(request.body.position) ? request.body.position : 0;
    // Clamp into the book's real bounds when the duration is known. A
    // non-finite or negative value resets to the start rather than persisting
    // garbage that would resume a book at an impossible offset.
    const duration = item.duration > 0 ? item.duration : 0;
    const position = duration > 0
      ? Math.min(Math.max(rawPosition, 0), duration)
      : Math.max(0, Number.isFinite(rawPosition) ? rawPosition : 0);
    const completed = request.body?.completed ?? (duration > 0 && position >= 0.95 * duration);

    // Upsert on the (mediaItem, profile) unique key: concurrent saves from the
    // periodic saver, the pause saver and an unmount can no longer both
    // decide "no row yet" and each create one.
    const saved = await prisma.listeningHistory.upsert({
      where: { mediaItemId_profileId: { mediaItemId: item.id, profileId } },
      create: { mediaItemId: item.id, profileId, position, completed },
      update: { position, completed },
    });
    return { position: saved.position, completed: saved.completed };
  });

  app.post<{ Params: { id: string }; Body: { fromPosition?: number; toPosition?: number; speed?: number; startedAt?: string; endedAt?: string } }>("/api/audiobooks/:id/sessions", {
    schema: {
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      body: {
        type: "object",
        properties: {
          fromPosition: { type: "number" },
          toPosition: { type: "number" },
          speed: { type: "number" },
          startedAt: { type: "string" },
          endedAt: { type: "string" },
        },
      },
    },
  }, async (request, reply) => {
    const profileId = requireProfileId(request);
    if (profileId === null) return fail(reply, 400, "profile_required");
    const item = await prisma.mediaItem.findUnique({ where: { id: parseIdParam(request.params.id) ?? -1 } });
    if (!item) return fail(reply, 404, "audiobook_not_found");
    const toPosition = Number(request.body?.toPosition);
    const fromPosition = Number(request.body?.fromPosition);
    if (!Number.isFinite(toPosition) || !Number.isFinite(fromPosition)) {
      return fail(reply, 400, "positions_required");
    }
    // Keep history rows physically meaningful: no negative offsets, and no
    // position past the end of the book.
    const safeTo = Math.min(Math.max(toPosition, 0), item.duration || toPosition);
    const safeFrom = Math.min(Math.max(fromPosition, 0), safeTo);
    const speed = Number(request.body?.speed);
    const safeSpeed = Number.isFinite(speed) && speed > 0 ? Math.min(speed, 10) : 1;
    const session = await prisma.playSession.create({
      data: {
        profileId,
        mediaItemId: item.id,
        fromPosition: safeFrom,
        toPosition: safeTo,
        speed: safeSpeed,
        startedAt: request.body?.startedAt ? new Date(request.body.startedAt) : new Date(),
        endedAt: request.body?.endedAt ? new Date(request.body.endedAt) : new Date(),
      },
    });
    const { profileId: _profileId, ...publicSession } = session;
    return reply.code(201).send(publicSession);
  });

  app.get("/api/history", async (request, reply) => {
    const profileId = requireProfileId(request);
    if (profileId === null) return fail(reply, 400, "profile_required");
    const sessions = await prisma.playSession.findMany({ where: { profileId }, orderBy: { startedAt: "desc" }, take: 100 });
    return sessions.map(({ profileId: _profileId, ...session }) => session);
  });
}
