/**
 * The administrative profile surface: profile CRUD and the per-profile
 * favourites list. (Self-service rights — export, rectify, erase — live in
 * gdpr.ts.)
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { fail } from "../http-errors";
import { ageContextFor, visibleForAge } from "../age/facts";
import { blockedGenreIds } from "../age/blocklist";
import { canProfileSeeBook } from "../age/policy";
import { isDemoMode, type AccountExperience } from "../auth/demo-policy";
import { publicBookPayload } from "../book-payload";

export interface ProfilesRouteDeps {
  prisma: PrismaClient;
  accountExperience: AccountExperience;
  authEnabled: boolean;
  parseIdParam: (raw: string | undefined) => number | null;
  requireProfileId: (request: FastifyRequest) => number | null;
}

const profileSummary = {
  id: true,
  name: true,
  color: true,
  role: true,
  createdAt: true,
  followsServerLibrary: true,
} as const;

export async function registerProfilesRoutes(
  app: FastifyInstance,
  deps: ProfilesRouteDeps,
): Promise<void> {
  const { prisma, accountExperience, authEnabled, parseIdParam, requireProfileId } = deps;

  // Profiles
  //
  app.get("/api/profiles", async (request, reply) => {
    if (isDemoMode(accountExperience)) return fail(reply, 404, "not_found");
    if (authEnabled && request.auth?.role !== "admin") return fail(reply, 403, "forbidden");
    return prisma.profile.findMany({ orderBy: { createdAt: "asc" }, select: profileSummary });
  });

  app.post<{ Body: { name?: string; color?: string } }>("/api/profiles", {
    schema: {
      body: {
        type: "object",
        properties: {
          name: { type: "string" },
          color: { type: "string" },
        },
      },
    },
  }, async (request, reply) => {
    if (isDemoMode(accountExperience)) return fail(reply, 404, "not_found");
    if (authEnabled && request.auth?.role !== "admin") return fail(reply, 403, "forbidden");
    const name = request.body?.name?.trim();
    if (!name) return fail(reply, 400, "profile_name_required");
    const existing = await prisma.profile.findUnique({ where: { name } });
    if (existing) return fail(reply, 409, "profile_name_taken");
    // Spec 27: a new profile starts EMPTY and does not follow the server
    // library. This is the one line the spec points at: flip
    // `followsServerLibrary` to true and copy the books across to give new
    // profiles the full library instead.
    const profile = await prisma.profile.create({
      data: { name, color: request.body?.color?.trim() || null },
      select: profileSummary,
    });
    return reply.code(201).send(profile);
  });

  app.delete<{ Params: { id: string } }>("/api/profiles/:id", {
    schema: {
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  }, async (request, reply) => {
    if (isDemoMode(accountExperience)) return fail(reply, 404, "not_found");
    if (authEnabled && request.auth?.role !== "admin") return fail(reply, 403, "forbidden");
    await prisma.profile.delete({ where: { id: parseIdParam(request.params.id) ?? -1 } });
    return reply.code(204).send();
  });

  // Favourites (per profile)

  app.put<{ Params: { id: string } }>("/api/audiobooks/:id/favourite", {
    schema: { params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } },
  }, async (request, reply) => {
    const profileId = requireProfileId(request);
    if (profileId === null) return fail(reply, 400, "profile_required");
    const id = parseIdParam(request.params.id);
    if (id === null) return fail(reply, 400, "invalid_id");
    const item = await prisma.mediaItem.findUnique({ where: { id }, select: { id: true } });
    if (!item) return fail(reply, 404, "audiobook_not_found");
    // Spec 38: a child may not favourite a book hidden by the age gate.
    if (!(await visibleForAge(prisma, request.auth?.role, profileId, id))) {
      return fail(reply, 404, "audiobook_not_found");
    }

    // Idempotent: favouriting twice is a no-op, not an error.
    const existing = await prisma.favourite.findUnique({
      where: { profileId_mediaItemId: { profileId, mediaItemId: id } },
    });
    if (existing) return { favourited: true, alreadyExisted: true };

    await prisma.favourite.create({ data: { profileId, mediaItemId: id } });
    return { favourited: true, alreadyExisted: false };
  });

  app.delete<{ Params: { id: string } }>("/api/audiobooks/:id/favourite", {
    schema: { params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } },
  }, async (request, reply) => {
    const profileId = requireProfileId(request);
    if (profileId === null) return fail(reply, 400, "profile_required");
    const id = parseIdParam(request.params.id);
    if (id === null) return fail(reply, 400, "invalid_id");

    // Un-favouriting something already un-favourited is a no-op.
    const { count } = await prisma.favourite.deleteMany({ where: { profileId, mediaItemId: id } });
    return { favourited: false, removed: count };
  });

  app.get("/api/favourites", async (request, reply) => {
    const profileId = requireProfileId(request);
    if (profileId === null) return fail(reply, 400, "profile_required");

    const favourites = await prisma.favourite.findMany({
      where: { profileId },
      orderBy: { createdAt: "desc" },
      include: {
        mediaItem: {
          include: {
            series: true,
            genres: { include: { genre: true } },
            customTags: { include: { tag: true } },
            contributors: { include: { contributor: true } },
          },
        },
      },
    });

    const ctx = await ageContextFor(prisma, request.auth?.role, profileId);
    // Spec 38: favourites of age-hidden books never surface to a child.
    const visible = ctx.role === "child"
      ? await (async () => {
          const blocked = await blockedGenreIds(prisma);
          return favourites.filter((row) => canProfileSeeBook(
            ctx,
            { minimumAge: row.mediaItem.minimumAge, genreIds: row.mediaItem.genres.map((g) => g.genreId) },
            blocked,
          ));
        })()
      : favourites;

    return visible.map((row) => ({
      favouritedAt: row.createdAt,
      // One book shape everywhere, same contributors/genres/tags mapping.
      book: publicBookPayload({ ...row.mediaItem, tracks: [] }),
    }));
  });

  /** The current profile's favourites, as a plain id set for list endpoints. */
  app.get("/api/favourites/ids", async (request, reply) => {
    const profileId = requireProfileId(request);
    if (profileId === null) return fail(reply, 400, "profile_required");
    const rows = await prisma.favourite.findMany({
      where: { profileId },
      select: { mediaItemId: true, mediaItem: { select: { minimumAge: true, genres: { select: { genreId: true } } } } },
    });
    const ctx = await ageContextFor(prisma, request.auth?.role, profileId);
    if (ctx.role !== "child") return rows.map((row) => row.mediaItemId);
    const blocked = await blockedGenreIds(prisma);
    return rows
      .filter((row) => canProfileSeeBook(
        ctx,
        { minimumAge: row.mediaItem.minimumAge, genreIds: row.mediaItem.genres.map((g) => g.genreId) },
        blocked,
      ))
      .map((row) => row.mediaItemId);
  });
}
