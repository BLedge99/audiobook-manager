import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { fail } from "../http-errors";
import { createTag, mergeTags, renameTag } from "../metadata/tags";
import { isDemoMode } from "../auth/demo-policy";
import { visibleItemScope } from "../age/facts";

export interface TaxonomyRouteDeps {
  prisma: PrismaClient;
  accountExperience: "household" | "demo";
  parseIdParam: (raw: string | undefined) => number | null;
  optionalProfileId: (request: FastifyRequest) => number | null;
}

export async function registerTaxonomyRoutes(
  app: FastifyInstance,
  deps: TaxonomyRouteDeps,
): Promise<void> {
  const { prisma, accountExperience, parseIdParam, optionalProfileId } = deps;

  // Spec 17 — taxonomy, tag suite, per-field overrides
  // ---------------------------------------------------------------------

  app.get("/api/genres", async (request) => {
    const genres = await prisma.genre.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { _count: { select: { items: true } } },
    });
    // Spec 38: for a child, counts are computed over their shelf ∩ the age
    // gate, so a count can reveal nothing beyond what they can open.
    const scope = await visibleItemScope(prisma, request.auth?.role, optionalProfileId(request));
    let scopedCounts: Map<number, number> | null = null;
    if (scope) {
      const rows = await prisma.mediaItemGenre.groupBy({
        by: ["genreId"],
        where: { mediaItem: scope as never },
        _count: { mediaItemId: true },
      });
      scopedCounts = new Map(rows.map((row) => [row.genreId, row._count.mediaItemId]));
    }
    const countFor = (id: number, fallback: number) => (scopedCounts ? scopedCounts.get(id) ?? 0 : fallback);
    // Build the two-level tree in one pass so the client does not have to.
    const roots = genres.filter((genre) => genre.parentId === null);
    return roots.map((root) => ({
      ...root,
      children: genres
        .filter((genre) => genre.parentId === root.id)
        .map((child) => ({ ...child, count: countFor(child.id, child._count.items), parent: undefined, _count: undefined })),
      count: countFor(root.id, root._count.items),
    }));
  });

  app.post<{ Body: { slug: string; name: string; parentId?: number; sortOrder?: number } }>("/api/genres", {
    schema: {
      body: {
        type: "object",
        properties: {
          slug: { type: "string", minLength: 1, maxLength: 80, pattern: "^[a-z0-9-]+$" },
          name: { type: "string", minLength: 1, maxLength: 120 },
          parentId: { type: "integer", minimum: 1 },
          sortOrder: { type: "integer" },
        },
        required: ["slug", "name"],
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    if (isDemoMode(accountExperience)) return fail(reply, 404, "not_found");
    const body = request.body;
    const existing = await prisma.genre.findUnique({ where: { slug: body.slug } });
    if (existing) return fail(reply, 409, "genre_slug_taken");
    if (body.parentId) {
      const parent = await prisma.genre.findUnique({ where: { id: body.parentId } });
      if (!parent) return fail(reply, 400, "parent_genre_not_found");
    }
    return prisma.genre.create({ data: body });
  });

  app.patch<{ Params: { id: string }; Body: { name?: string; parentId?: number; sortOrder?: number } }>("/api/genres/:id", {
    schema: {
      params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
      body: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1, maxLength: 120 },
          parentId: { type: "integer", minimum: 1 },
          sortOrder: { type: "integer" },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    if (isDemoMode(accountExperience)) return fail(reply, 404, "not_found");
    const id = parseIdParam(request.params.id);
    if (id === null) return fail(reply, 400, "invalid_id");
    const genre = await prisma.genre.findUnique({ where: { id } });
    if (!genre) return fail(reply, 404, "genre_not_found");
    // Pick schema-whitelisted fields explicitly; never pass the raw body to Prisma.
    const { name, parentId, sortOrder } = request.body;
    const data: { name?: string; parentId?: number; sortOrder?: number } = {};
    if (name !== undefined) data.name = name;
    if (parentId !== undefined) data.parentId = parentId;
    if (sortOrder !== undefined) data.sortOrder = sortOrder;
    return prisma.genre.update({ where: { id }, data });
  });

  app.delete<{ Params: { id: string } }>("/api/genres/:id", {
    schema: { params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } },
  }, async (request, reply) => {
    if (isDemoMode(accountExperience)) return fail(reply, 404, "not_found");
    const id = parseIdParam(request.params.id);
    if (id === null) return fail(reply, 400, "invalid_id");
    const genre = await prisma.genre.findUnique({ where: { id } });
    if (!genre) return fail(reply, 404, "genre_not_found");
    // The catch-all bucket is load-bearing: unmapped provider genres land
    // there. Removing it would silently discard genres on the next pass.
    if (genre.isCatchAll) return fail(reply, 409, "catch_all_genre_undeletable");
    await prisma.genre.delete({ where: { id } });
    return { deleted: true };
  });

  app.get("/api/tags", async (request, _reply) => {
    const tags = await prisma.tag.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { items: true } } },
    });
    // Spec 38: for a child, counts cover their shelf ∩ the age gate only.
    const scope = await visibleItemScope(prisma, request.auth?.role, optionalProfileId(request));
    let scopedCounts: Map<number, number> | null = null;
    if (scope) {
      const rows = await prisma.mediaItemTag.groupBy({
        by: ["tagId"],
        where: { mediaItem: scope as never },
        _count: { mediaItemId: true },
      });
      scopedCounts = new Map(rows.map((row) => [row.tagId, row._count.mediaItemId]));
    }
    // Counts come from the same rows the UI lists, so a count can never
    // disagree with the number of books behind it.
    return tags.map((tag) => ({ id: tag.id, name: tag.name, count: scopedCounts ? scopedCounts.get(tag.id) ?? 0 : tag._count.items }));
  });

  app.post<{ Body: { name: string } }>("/api/tags", {
    schema: {
      body: {
        type: "object",
        properties: { name: { type: "string", minLength: 1, maxLength: 100 } },
        required: ["name"],
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    if (isDemoMode(accountExperience)) return fail(reply, 404, "not_found");
    const body = request.body;
    const result = await createTag(prisma, body.name, optionalProfileId(request));
    if ("reason" in result) return fail(reply, 409, "tag_name_rejected", { reason: result.reason });
    return reply.code(result.created ? 201 : 200).send(result.tag);
  });

  app.patch<{ Params: { id: string }; Body: { name: string } }>("/api/tags/:id", {
    schema: {
      params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
      body: {
        type: "object",
        properties: { name: { type: "string", minLength: 1, maxLength: 100 } },
        required: ["name"],
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    if (isDemoMode(accountExperience)) return fail(reply, 404, "not_found");
    const id = parseIdParam(request.params.id);
    if (id === null) return fail(reply, 400, "invalid_id");
    const result = await renameTag(prisma, id, request.body.name);
    if ("reason" in result) return fail(reply, 409, "tag_name_rejected", { reason: result.reason });
    return result.tag;
  });

  app.delete<{ Params: { id: string } }>("/api/tags/:id", {
    schema: { params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } },
  }, async (request, reply) => {
    if (isDemoMode(accountExperience)) return fail(reply, 404, "not_found");
    const id = parseIdParam(request.params.id);
    if (id === null) return fail(reply, 400, "invalid_id");
    const tag = await prisma.tag.findUnique({ where: { id } });
    if (!tag) return fail(reply, 404, "tag_not_found");
    // Cascades to MediaItemTag, so every assignment goes with it.
    await prisma.tag.delete({ where: { id } });
    return { deleted: true };
  });

  app.post<{ Params: { id: string }; Body: { targetTagId: number } }>("/api/tags/:id/merge", {
    schema: {
      params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
      body: {
        type: "object",
        properties: { targetTagId: { type: "integer", minimum: 1 } },
        required: ["targetTagId"],
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    if (isDemoMode(accountExperience)) return fail(reply, 404, "not_found");
    const id = parseIdParam(request.params.id);
    if (id === null) return fail(reply, 400, "invalid_id");
    const { targetTagId } = request.body;
    const result = await mergeTags(prisma, id, targetTagId);
    if ("reason" in result) {
      const status = result.reason === "not-found" ? 404 : 400;
      return fail(reply, status, "tag_merge_failed", { reason: result.reason });
    }
    // The count is reported so the UI can confirm how many books moved.
    return { moved: result.moved, mergedInto: targetTagId };
  });
}

