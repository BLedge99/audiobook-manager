import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { PrismaClient } from "@prisma/client";
import { fail } from "../http-errors";
import { clampPosition, normalizeSessionBounds, normalizeSessionSpeed, resolveCompleted } from "../progress-math";

export interface ProgressRoutesOptions {
  prisma: PrismaClient;
  requireProfileId: (request: FastifyRequest) => number | null;
  parseIdParam: (raw: string | undefined) => number | null;
}

/**
 * Progress + listening-history routes (profile-scoped).
 *
 * Extracted from the app module as the first feature-module cut of the
 * architecture split: the route handlers keep their behaviour, and the pure
 * mathematics they apply live in `progress-math`.
 */
export function registerProgressRoutes(app: FastifyInstance, options: ProgressRoutesOptions): void {
  const { prisma, requireProfileId, parseIdParam } = options;

  app.get<{ Params: { id: string } }>("/api/audiobooks/:id/progress", async (request, reply) => {
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

  app.put<{ Params: { id: string }; Body: { position?: number; completed?: boolean } }>("/api/audiobooks/:id/progress", async (request, reply) => {
    const profileId = requireProfileId(request);
    if (profileId === null) return fail(reply, 400, "profile_required");
    const item = await prisma.mediaItem.findUnique({ where: { id: parseIdParam(request.params.id) ?? -1 } });
    if (!item) return fail(reply, 404, "audiobook_not_found");

    const rawPosition = typeof request.body?.position === "number" && Number.isFinite(request.body.position) ? request.body.position : 0;
    // Clamp into the book's real bounds when the duration is known. A
    // non-finite or negative value resets to the start rather than persisting
    // garbage that would resume a book at an impossible offset.
    const duration = item.duration > 0 ? item.duration : 0;
    const position = clampPosition(rawPosition, duration);
    const completed = resolveCompleted(position, duration, request.body?.completed);

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

  app.post<{ Params: { id: string }; Body: { fromPosition?: number; toPosition?: number; speed?: number; startedAt?: string; endedAt?: string } }>("/api/audiobooks/:id/sessions", async (request, reply) => {
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
    const { from: safeFrom, to: safeTo } = normalizeSessionBounds(toPosition, fromPosition, item.duration);
    const safeSpeed = normalizeSessionSpeed(Number(request.body?.speed));
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
