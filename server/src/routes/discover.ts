import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { fail } from "../http-errors";
import { isDemoMode } from "../auth/demo-policy";
import { RecommendationService, DEFAULT_PAGE_SIZE } from "../metadata/recommend-service";
import { childDiscoverFilter, visibleForAge } from "../age/facts";

const MAX_PAGE_SIZE = 20;

export interface DiscoverRouteDeps {
  prisma: PrismaClient;
  accountExperience: "household" | "demo";
  recommendations: RecommendationService;
  parseIdParam: (raw: string | undefined) => number | null;
  requireProfileId: (request: FastifyRequest) => number | null;
}

function decodeJsonList(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Wishlist items are metadata-only by construction (spec 19): there is no
 * filePath, no Track and no audio route for them. Serialising them here
 * makes that explicit rather than incidental.
 */
function publicWishlistItem(item: {
  id: number;
  title: string;
  author: string | null;
  narrators: string | null;
  description: string | null;
  coverUrl: string | null;
  coverPath: string | null;
  genres: string | null;
  seriesName: string | null;
  publisher: string | null;
  publishedYear: number | null;
  provider: string | null;
  seedMediaItemId: number | null;
  owned: boolean;
  createdAt: Date;
}) {
  return {
    id: item.id,
    title: item.title,
    author: item.author,
    narrators: decodeJsonList(item.narrators),
    description: item.description,
    coverUrl: item.coverUrl,
    genres: decodeJsonList(item.genres),
    seriesName: item.seriesName,
    publisher: item.publisher,
    publishedYear: item.publishedYear,
    provider: item.provider,
    seedMediaItemId: item.seedMediaItemId,
    owned: item.owned,
    createdAt: item.createdAt,
    playable: false,
  };
}

/**
 * Recommendations carry no local paths by construction (they come from
 * external providers), so there is nothing to strip. Keep the helper so
 * the guarantee stays explicit and easy to enforce if caching ever lands.
 */
function publicRecommendations<T>(result: T): T {
  return result;
}

/**
 * Paging parameters for both discover routes.
 *
 * Fastify has already coerced and range-checked these against the schemas, so
 * anything that is still not a finite integer is clamped rather than trusted.
 * `pageSize` is capped at the service's own maximum so a hand-typed
 * `?pageSize=20` cannot ask for a different product shape than the UI renders.
 */
function readPaging(query: { page?: number; pageSize?: number }): { page: number; pageSize: number } {
  const page = Number.isInteger(query.page) && query.page! >= 1 ? query.page! : 1;
  const requested = Number.isInteger(query.pageSize) && query.pageSize! >= 1 ? query.pageSize! : DEFAULT_PAGE_SIZE;
  return { page, pageSize: Math.min(requested, MAX_PAGE_SIZE) };
}

export async function registerDiscoverRoutes(
  app: FastifyInstance,
  deps: DiscoverRouteDeps,
): Promise<void> {
  const { prisma, accountExperience, recommendations, parseIdParam, requireProfileId } = deps;

  // ---------------------------------------------------------------------
  // Spec 19 — Discover & wishlist
  // ---------------------------------------------------------------------

  app.get<{ Params: { id: string }; Querystring: { page?: number; pageSize?: number } }>("/api/discover/similar/:id", {
    schema: {
      params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
      querystring: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 50 },
          page: { type: "integer", minimum: 1, maximum: 100 },
          pageSize: { type: "integer", minimum: 1, maximum: 20 },
        },
      },
    },
  }, async (request, reply) => {
    if (isDemoMode(accountExperience) && request.auth?.session.profileId == null) return fail(reply, 404, "not_found");
    const id = parseIdParam(request.params.id);
    if (id === null) return fail(reply, 400, "invalid_id");
    const exists = await prisma.mediaItem.findUnique({ where: { id }, select: { id: true } });
    if (!exists) return fail(reply, 404, "audiobook_not_found");
    // Spec 38: a child may not seed Discover from a book they were not shown.
    const child = await childDiscoverFilter(prisma, request.auth?.role, request.auth?.session.profileId ?? null);
    if (child && !(await visibleForAge(prisma, request.auth?.role, request.auth?.session.profileId ?? null, id))) {
      return fail(reply, 404, "audiobook_not_found");
    }

    const { page, pageSize } = readPaging(request.query);
    const result = await recommendations.similarTo(id, { page, pageSize, child });
    return publicRecommendations(result);
  });

  app.get<{ Querystring: { page?: number; pageSize?: number } }>("/api/discover/for-me", {
    // Spec 11: every route validates its input. This one previously validated
    // nothing and read `request.query` by hand, which is how a limit of
    // "twenty" or "-1" would have reached the service as NaN.
    schema: {
      querystring: {
        type: "object",
        properties: {
          page: { type: "integer", minimum: 1, maximum: 100 },
          pageSize: { type: "integer", minimum: 1, maximum: 20 },
        },
      },
    },
  }, async (request, reply) => {
    const profileId = requireProfileId(request);
    if (profileId === null) return fail(reply, 400, "profile_required");
    const { page, pageSize } = readPaging(request.query);
    // Spec 38: a child gets only suggestions the ladder can confirm suitable.
    const child = await childDiscoverFilter(prisma, request.auth?.role, profileId);
    const result = await recommendations.forProfile(profileId, { page, pageSize, child });
    return publicRecommendations(result);
  });

  app.get("/api/wishlist", async (request, reply) => {
    const profileId = requireProfileId(request);
    if (profileId === null) return fail(reply, 400, "profile_required");
    const items = await prisma.wishlistItem.findMany({
      where: { profileId },
      orderBy: { createdAt: "desc" },
    });
    return items.map(publicWishlistItem);
  });

  app.post<{ Body: {
      title: string;
      author?: string;
      narrators?: string[];
      description?: string;
      coverUrl?: string;
      genres?: string[];
      seriesName?: string;
      publisher?: string;
      publishedYear?: number;
      provider: string;
      providerKey: string;
      seedMediaItemId?: number;
    } }>("/api/wishlist", {
    schema: {
      body: {
        type: "object",
        properties: {
          title: { type: "string", minLength: 1, maxLength: 500 },
          author: { type: "string", maxLength: 500 },
          narrators: { type: "array", items: { type: "string" }, maxItems: 20 },
          description: { type: "string", maxLength: 4000 },
          coverUrl: { type: "string", maxLength: 2000 },
          genres: { type: "array", items: { type: "string" }, maxItems: 20 },
          seriesName: { type: "string", maxLength: 300 },
          publisher: { type: "string", maxLength: 300 },
          publishedYear: { type: "integer", minimum: 0, maximum: 3000 },
          provider: { type: "string", minLength: 1, maxLength: 50 },
          providerKey: { type: "string", minLength: 1, maxLength: 200 },
          seedMediaItemId: { type: "integer", minimum: 1 },
        },
        required: ["title", "provider", "providerKey"],
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const profileId = requireProfileId(request);
    if (profileId === null) return fail(reply, 400, "profile_required");
    const body = request.body;

    const item = await recommendations.saveToWishlist(
      profileId,
      { ...body, narrators: body.narrators ?? [], genres: (body.genres ?? []).slice(0, 20), score: 0, reason: { code: "related" } },
      body.seedMediaItemId,
    );
    return reply.code(201).send(publicWishlistItem(item));
  });

  app.delete<{ Params: { id: string } }>("/api/wishlist/:id", {
    schema: { params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } },
  }, async (request, reply) => {
    const profileId = requireProfileId(request);
    if (profileId === null) return fail(reply, 400, "profile_required");
    const id = parseIdParam(request.params.id);
    if (id === null) return fail(reply, 400, "invalid_id");

    // Scoped by profile: one profile cannot delete another's wishlist entry.
    const { count } = await prisma.wishlistItem.deleteMany({ where: { id, profileId } });
    if (count === 0) return fail(reply, 404, "wishlist_item_not_found");
    return { deleted: true };
  });

  app.put<{ Params: { id: string }; Body: { owned?: boolean } }>("/api/wishlist/:id/owned", {
    schema: {
      params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
      body: {
        type: "object",
        properties: { owned: { type: "boolean" } },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const profileId = requireProfileId(request);
    if (profileId === null) return fail(reply, 400, "profile_required");
    const id = parseIdParam(request.params.id);
    if (id === null) return fail(reply, 400, "invalid_id");
    const owned = request.body?.owned ?? true;

    const result = await prisma.wishlistItem.updateMany({ where: { id, profileId }, data: { owned } });
    if (result.count === 0) return fail(reply, 404, "wishlist_item_not_found");
    const item = await prisma.wishlistItem.findUnique({ where: { id } });
    return publicWishlistItem(item!);
  });
}
