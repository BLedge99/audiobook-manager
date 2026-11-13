/**
 * Spec 38 / ADR 033 — age ratings for books and the household genre
 * blocklist, managed from the admin panel.
 *
 * A confirmed `minimumAge` (set here) always wins. Provider-derived values
 * live in `suggestedMinimumAge` and never gate anything; the operator can
 * confirm one (becomes the confirmed rating), dismiss it, or set any value
 * on the 0/4/7/9/12/16 ladder — including clearing it altogether (null =
 * unrated = visible to every band).
 */
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { fail } from "../http-errors";
import { requireAdminSession, type AdminAuth } from "./auth";

export interface AgeRatingRouteDeps {
  prisma: PrismaClient;
  auth: AdminAuth;
}

const LADDER: readonly number[] = [0, 4, 7, 9, 12, 16];

export function registerAgeRatingRoutes(
  app: FastifyInstance,
  deps: AgeRatingRouteDeps,
): void {
  const { prisma, auth } = deps;
  const guard = { preHandler: requireAdminSession(auth) };

  app.get<{ Querystring: { q?: string } }>(
    "/api/admin/age-ratings/books",
    {
      ...guard,
      schema: {
        querystring: {
          type: "object",
          properties: { q: { type: "string", maxLength: 200 } },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      const query = request.query.q?.trim().toLowerCase() ?? "";
      const everything = await prisma.mediaItem.findMany({
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          title: true,
          author: true,
          publishedYear: true,
          minimumAge: true,
          suggestedMinimumAge: true,
          suggestedMinimumAgeSource: true,
        },
        take: 5000,
      });
      // Portable substring search (SQLite LIKE is ASCII-only; do it in JS).
      const matches = query === ""
        ? everything
        : everything.filter((item) => `${item.title} ${item.author ?? ""}`.toLowerCase().includes(query));
      return { books: matches.slice(0, 50) };
    },
  );

  app.get("/api/admin/age-ratings/review", guard, async () => {
    const items = await prisma.mediaItem.findMany({
      where: { suggestedMinimumAge: { not: null } },
      orderBy: { title: "asc" },
      select: {
        id: true,
        title: true,
        author: true,
        publishedYear: true,
        minimumAge: true,
        suggestedMinimumAge: true,
        suggestedMinimumAgeSource: true,
      },
    });
    return { items };
  });

  app.post<{ Body: { mediaItemId: number; minimumAge: number | null } }>(
    "/api/admin/age-ratings/set",
    {
      ...guard,
      schema: {
        body: {
          type: "object",
          properties: {
            mediaItemId: { type: "integer", minimum: 1 },
            minimumAge: { type: ["integer", "null"], enum: [0, 4, 7, 9, 12, 16, null] },
          },
          required: ["mediaItemId", "minimumAge"],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { mediaItemId, minimumAge } = request.body;
      if (minimumAge !== null && !LADDER.includes(minimumAge)) {
        return fail(reply, 400, "request_invalid", { reason: "minimum-age-ladder" });
      }
      const item = await prisma.mediaItem.findUnique({ where: { id: mediaItemId }, select: { id: true } });
      if (!item) return fail(reply, 404, "audiobook_not_found");
      const updated = await prisma.mediaItem.update({
        where: { id: mediaItemId },
        data: { minimumAge, suggestedMinimumAge: null, suggestedMinimumAgeSource: null },
        select: { id: true, title: true, minimumAge: true },
      });
      return updated;
    },
  );

  app.post<{ Body: { mediaItemId: number } }>(
    "/api/admin/age-ratings/confirm",
    {
      ...guard,
      schema: {
        body: {
          type: "object",
          properties: { mediaItemId: { type: "integer", minimum: 1 } },
          required: ["mediaItemId"],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const item = await prisma.mediaItem.findUnique({
        where: { id: request.body.mediaItemId },
        select: { id: true, suggestedMinimumAge: true },
      });
      if (!item) return fail(reply, 404, "audiobook_not_found");
      if (item.suggestedMinimumAge === null) {
        return fail(reply, 400, "request_invalid", { reason: "no-suggestion" });
      }
      const updated = await prisma.mediaItem.update({
        where: { id: item.id },
        data: {
          minimumAge: item.suggestedMinimumAge,
          suggestedMinimumAge: null,
          suggestedMinimumAgeSource: null,
        },
        select: { id: true, title: true, minimumAge: true },
      });
      return updated;
    },
  );

  app.post<{ Body: { mediaItemId: number } }>(
    "/api/admin/age-ratings/dismiss",
    {
      ...guard,
      schema: {
        body: {
          type: "object",
          properties: { mediaItemId: { type: "integer", minimum: 1 } },
          required: ["mediaItemId"],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const item = await prisma.mediaItem.findUnique({
        where: { id: request.body.mediaItemId },
        select: { id: true },
      });
      if (!item) return fail(reply, 404, "audiobook_not_found");
      await prisma.mediaItem.update({
        where: { id: item.id },
        data: { suggestedMinimumAge: null, suggestedMinimumAgeSource: null },
      });
      return { ok: true };
    },
  );

  /**
   * Spec 38: the blocklist as the admin sees it — the blocked genres only,
   * each with its book count. `options` finds unblocked genres to add.
   *
   * Listing every genre and rendering it with a toggle was removed on
   * 2026-11-13: the taxonomy is large, and the list drowned the handful of
   * relevant ones.
   */
  app.get("/api/admin/genre-blocklist", guard, async () => {
    const blocked = await prisma.blocklistGenre.findMany({
      orderBy: [{ genre: { sortOrder: "asc" } }, { genre: { name: "asc" } }],
      include: { genre: { include: { _count: { select: { items: true } } } } },
    });
    return {
      genres: blocked.map((row) => ({
        id: row.genre.id,
        slug: row.genre.slug,
        name: row.genre.name,
        count: row.genre._count.items,
      })),
    };
  });

  app.get<{ Querystring: { q?: string } }>(
    "/api/admin/genre-blocklist/options",
    {
      ...guard,
      schema: {
        querystring: {
          type: "object",
          properties: { q: { type: "string", maxLength: 120 } },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      const blockedIds = await prisma.blocklistGenre.findMany({ select: { genreId: true } });
      const blocked = new Set(blockedIds.map((row) => row.genreId));
      const all = await prisma.genre.findMany({
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: { _count: { select: { items: true } } },
      });
      const query = request.query.q?.trim().toLowerCase() ?? "";
      // Portable substring match (SQLite LIKE is ASCII-only).
      const matches = all.filter((genre) => {
        if (blocked.has(genre.id)) return false;
        if (query === "") return true;
        return `${genre.name} ${genre.slug}`.toLowerCase().includes(query);
      });
      return {
        genres: matches.slice(0, 20).map((genre) => ({
          id: genre.id,
          slug: genre.slug,
          name: genre.name,
          count: genre._count.items,
        })),
      };
    },
  );

  app.post<{ Body: { genreId: number } }>(
    "/api/admin/genre-blocklist",
    {
      ...guard,
      schema: {
        body: {
          type: "object",
          properties: { genreId: { type: "integer", minimum: 1 } },
          required: ["genreId"],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const genre = await prisma.genre.findUnique({ where: { id: request.body.genreId }, select: { id: true } });
      if (!genre) return fail(reply, 404, "unknown_genre_id");
      const existing = await prisma.blocklistGenre.findUnique({ where: { genreId: genre.id }, select: { id: true } });
      if (existing) return { added: false };
      await prisma.blocklistGenre.create({ data: { genreId: genre.id } });
      return reply.code(201).send({ added: true });
    },
  );

  app.delete<{ Params: { genreId: string } }>(
    "/api/admin/genre-blocklist/:genreId",
    {
      ...guard,
      schema: { params: { type: "object", properties: { genreId: { type: "string", pattern: "^[1-9][0-9]*$", maxLength: 10 } }, required: ["genreId"], additionalProperties: false } },
    },
    async (request) => {
      const genreId = Number(request.params.genreId);
      const { count } = await prisma.blocklistGenre.deleteMany({ where: { genreId } });
      return { removed: count > 0 };
    },
  );
}
