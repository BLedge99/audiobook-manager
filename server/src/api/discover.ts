import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { fail } from "../http-errors";
import { DEFAULT_PAGE_SIZE, RecommendationService } from "../metadata/recommend-service";

interface DiscoverRoutesOptions {
  prisma: PrismaClient;
  recommendations: RecommendationService;
  accountExperience: "household" | "demo";
  requireProfileId: (request: FastifyRequest) => number | null;
  parseIdParam: (raw: string | undefined) => number | null;
}

function decodeJsonList(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function publicWishlistItem(item: {
  id: number;
  title: string;
  author: string | null;
  narrators: string | null;
  description: string | null;
  coverUrl: string | null;
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

export function registerDiscoverRoutes(app: FastifyInstance, options: DiscoverRoutesOptions): void {
  const { prisma, recommendations, accountExperience, requireProfileId, parseIdParam } = options;

  const readPaging = (query: { page?: number; pageSize?: number }) => {
    const page = Number.isInteger(query.page) && query.page! >= 1 ? query.page! : 1;
    const requested = Number.isInteger(query.pageSize) && query.pageSize! >= 1 ? query.pageSize! : DEFAULT_PAGE_SIZE;
    return { page, pageSize: Math.min(requested, 20) };
  };

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
    if (accountExperience === "demo" && request.auth?.session.profileId == null) {
      return fail(reply, 401, "auth_required");
    }
    const id = parseIdParam(request.params.id);
    if (id === null) return fail(reply, 400, "invalid_id");
    const exists = await prisma.mediaItem.findUnique({ where: { id }, select: { id: true } });
    if (!exists) return fail(reply, 404, "audiobook_not_found");

    return recommendations.similarTo(id, readPaging(request.query));
  });

  app.get<{ Querystring: { page?: number; pageSize?: number } }>("/api/discover/for-me", {
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
    return recommendations.forProfile(profileId, readPaging(request.query));
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

  app.post("/api/wishlist", {
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
    const body = request.body as {
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
    };
    const item = await recommendations.saveToWishlist(
      profileId,
      { ...body, narrators: body.narrators ?? [], genres: body.genres ?? [], score: 0, reason: { code: "related" } },
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
    const { count } = await prisma.wishlistItem.deleteMany({ where: { id, profileId } });
    if (count === 0) return fail(reply, 404, "wishlist_item_not_found");
    return { deleted: true };
  });

  app.put<{ Params: { id: string }; Body: { owned?: boolean } }>("/api/wishlist/:id/owned", {
    schema: { params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } },
  }, async (request, reply) => {
    const profileId = requireProfileId(request);
    if (profileId === null) return fail(reply, 400, "profile_required");
    const id = parseIdParam(request.params.id);
    if (id === null) return fail(reply, 400, "invalid_id");
    const owned = request.body?.owned ?? true;
    const result = await prisma.wishlistItem.updateMany({ where: { id, profileId }, data: { owned } });
    if (result.count === 0) return fail(reply, 404, "wishlist_item_not_found");
    const item = await prisma.wishlistItem.findUnique({ where: { id } });
    if (!item) return fail(reply, 404, "wishlist_item_not_found");
    return publicWishlistItem(item);
  });
}
