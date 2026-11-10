import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Prisma, PrismaClient } from "@prisma/client";
import { fail } from "../http-errors";
import { applyCandidate, rowToCandidate, storeCandidates } from "../metadata/apply";
import { coverFilename, fetchCover } from "../metadata/cover";
import { runChain } from "../metadata/chain";
import { buildQuery, EnrichmentManager } from "../metadata/run";
import { upsertSeries } from "../metadata/taxonomy-service";
import { setBookTags } from "../metadata/tags";

interface MetadataRoutesOptions {
  prisma: PrismaClient;
  enrichment: EnrichmentManager;
  accountExperience: "household" | "demo";
  parseIdParam: (raw: string | undefined) => number | null;
  canReadMediaItem: (request: FastifyRequest, mediaItemId: number) => Promise<boolean>;
}

const CANDIDATE_OVERRIDE_COLUMNS: Record<string, string | undefined> = {
  title: "title",
  author: "author",
  narrator: "narrator",
  description: "description",
  publishedYear: "publishedYear",
  isbn: "isbn",
  publisher: "publisher",
  language: "language",
  coverImagePath: "coverImagePath",
  series: undefined,
  genres: undefined,
  contributors: undefined,
};

function publicMediaItem<T extends Record<string, unknown>>(item: T): Omit<T, "filePath" | "coverImagePath"> {
  const { filePath: _filePath, coverImagePath: _cover, ...rest } = item;
  return rest as Omit<T, "filePath" | "coverImagePath">;
}

export function registerMetadataRoutes(app: FastifyInstance, options: MetadataRoutesOptions): void {
  const { prisma, enrichment, accountExperience, parseIdParam, canReadMediaItem } = options;

  app.post<{ Params: { id: string } }>("/api/audiobooks/:id/enrich", {
    schema: { params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } },
  }, async (request, reply) => {
    if (accountExperience === "demo") return fail(reply, 404, "not_found");
    const id = parseIdParam(request.params.id);
    if (id === null) return fail(reply, 400, "invalid_id");
    const item = await prisma.mediaItem.findUnique({ where: { id } });
    if (!item) return fail(reply, 404, "audiobook_not_found");
    const result = await runChain(buildQuery(item), { collectAll: true });
    await storeCandidates(prisma, id, result.candidates);
    return result.candidates.map(({ raw: _raw, ...candidate }) => candidate);
  });

  app.post("/api/enrichment/run", {
    schema: {
      body: {
        type: "object",
        properties: {
          mediaItemId: { type: "integer", minimum: 1 },
          force: { type: "boolean", default: false },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    if (accountExperience === "demo") return fail(reply, 404, "not_found");
    const body = (request.body ?? {}) as { mediaItemId?: number; force?: boolean };
    return enrichment.enqueue({ mediaItemId: body.mediaItemId, force: body.force });
  });

  app.get("/api/enrichment/status", async (_request, reply) => (
    accountExperience === "demo" ? fail(reply, 404, "not_found") : enrichment.status()
  ));

  app.get("/api/enrichment/review-queue", async (_request, reply) => {
    if (accountExperience === "demo") return fail(reply, 404, "not_found");
    const items = await prisma.mediaItem.findMany({
      where: { enrichmentStatus: "review" },
      orderBy: { updatedAt: "desc" },
    });
    return items.map(publicMediaItem);
  });

  app.get<{ Params: { id: string } }>("/api/audiobooks/:id/candidates", {
    schema: { params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } },
  }, async (request, reply) => {
    if (accountExperience === "demo") return fail(reply, 404, "not_found");
    const id = parseIdParam(request.params.id);
    if (id === null) return fail(reply, 400, "invalid_id");
    const item = await prisma.mediaItem.findUnique({ where: { id } });
    if (!item) return fail(reply, 404, "audiobook_not_found");
    const rows = await prisma.metadataCandidate.findMany({
      where: { mediaItemId: id },
      orderBy: { confidence: "desc" },
    });
    return rows.map(({ raw: _raw, providerKey: _key, ...rest }) => rest);
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/api/audiobooks/:id/metadata", {
    schema: {
      params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
      body: {
        type: "object",
        properties: {
          candidateId: { type: "integer", minimum: 1 },
          title: { type: "string", minLength: 1, maxLength: 500 },
          author: { type: "string", minLength: 1, maxLength: 500 },
          narrator: { type: "string", maxLength: 500 },
          description: { type: "string", maxLength: 4000 },
          coverUrl: { type: "string", maxLength: 2000 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    if (accountExperience === "demo") return fail(reply, 404, "not_found");
    const id = parseIdParam(request.params.id);
    if (id === null) return fail(reply, 400, "invalid_id");
    const item = await prisma.mediaItem.findUnique({ where: { id } });
    if (!item) return fail(reply, 404, "audiobook_not_found");

    const body = (request.body ?? {}) as {
      candidateId?: number;
      title?: string;
      author?: string;
      narrator?: string;
      description?: string;
      coverUrl?: string;
    };
    const data: Record<string, unknown> = {};
    if (body.candidateId !== undefined) {
      const candidate = await prisma.metadataCandidate.findUnique({ where: { id: body.candidateId } });
      if (!candidate || candidate.mediaItemId !== id) return fail(reply, 400, "candidate_not_found");
      const applied = await applyCandidate(prisma, item, rowToCandidate(candidate));
      if (applied.coverImagePath) data.coverImagePath = applied.coverImagePath;
      data.enrichmentStatus = "applied";
      data.enrichedAt = new Date();
      data.metadataSource = "manual";

      const refreshed = await prisma.mediaItem.findUnique({ where: { id } });
      for (const field of applied.fields) {
        const column = CANDIDATE_OVERRIDE_COLUMNS[field] ?? field;
        if (!column) continue;
        const value = refreshed ? (refreshed as Record<string, unknown>)[column] : undefined;
        if (value === null || value === undefined || value === "") continue;
        await prisma.fieldOverride.upsert({
          where: { mediaItemId_field: { mediaItemId: id, field } },
          create: { mediaItemId: id, field, value: String(value) },
          update: { value: String(value) },
        });
      }
    } else {
      if (body.title !== undefined) data.title = body.title.trim();
      if (body.author !== undefined) data.author = body.author.trim();
      if (body.narrator !== undefined) data.narrator = body.narrator.trim() || null;
      if (body.description !== undefined) data.description = body.description.trim() || null;
      data.metadataSource = "manual";
      if (body.coverUrl) {
        const result = await fetchCover(body.coverUrl.trim(), coverFilename("manual", `${id}-${Date.now()}`));
        if (result.ok && result.path) data.coverImagePath = result.path;
      }
    }

    const updated = await prisma.mediaItem.update({
      where: { id },
      data: data as Prisma.MediaItemUncheckedUpdateInput,
    });
    return publicMediaItem(updated);
  });

  app.get("/api/genres", async () => {
    const genres = await prisma.genre.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { _count: { select: { items: true } } },
    });
    const roots = genres.filter((genre) => genre.parentId === null);
    return roots.map((root) => ({
      ...root,
      children: genres
        .filter((genre) => genre.parentId === root.id)
        .map((child) => ({ ...child, count: child._count.items, parent: undefined, _count: undefined })),
      count: root._count.items,
    }));
  });

  app.post("/api/genres", {
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
    if (accountExperience === "demo") return fail(reply, 404, "not_found");
    const body = request.body as { slug: string; name: string; parentId?: number; sortOrder?: number };
    const existing = await prisma.genre.findUnique({ where: { slug: body.slug } });
    if (existing) return fail(reply, 409, "genre_slug_taken");
    if (body.parentId && !(await prisma.genre.findUnique({ where: { id: body.parentId } }))) {
      return fail(reply, 400, "parent_genre_not_found");
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
    if (accountExperience === "demo") return fail(reply, 404, "not_found");
    const id = parseIdParam(request.params.id);
    if (id === null) return fail(reply, 400, "invalid_id");
    const genre = await prisma.genre.findUnique({ where: { id } });
    if (!genre) return fail(reply, 404, "genre_not_found");
    return prisma.genre.update({ where: { id }, data: request.body as Prisma.GenreUpdateInput });
  });

  app.delete<{ Params: { id: string } }>("/api/genres/:id", {
    schema: { params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } },
  }, async (request, reply) => {
    if (accountExperience === "demo") return fail(reply, 404, "not_found");
    const id = parseIdParam(request.params.id);
    if (id === null) return fail(reply, 400, "invalid_id");
    const genre = await prisma.genre.findUnique({ where: { id } });
    if (!genre) return fail(reply, 404, "genre_not_found");
    if (genre.isCatchAll) return fail(reply, 409, "catch_all_genre_undeletable");
    await prisma.genre.delete({ where: { id } });
    return { deleted: true };
  });

  app.get<{ Params: { id: string } }>("/api/audiobooks/:id/tags", {
    schema: { params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } },
  }, async (request, reply) => {
    if (accountExperience === "demo" && request.auth?.session.profileId == null) {
      return fail(reply, 401, "auth_required");
    }
    const id = parseIdParam(request.params.id);
    if (id === null) return fail(reply, 400, "invalid_id");
    const item = await prisma.mediaItem.findUnique({
      where: { id },
      include: {
        series: true,
        genres: { include: { genre: { include: { parent: true } } } },
        overrides: true,
        contributors: { include: { contributor: true } },
      },
    });
    if (!item) return fail(reply, 404, "audiobook_not_found");
    if (accountExperience === "demo" && !(await canReadMediaItem(request, item.id))) {
      return fail(reply, 404, "audiobook_not_found");
    }
    const overridden = new Set(item.overrides.map((row) => row.field));
    return {
      id: item.id,
      title: item.title,
      subtitle: item.subtitle,
      author: item.author,
      description: item.description,
      publisher: item.publisher,
      publishedYear: item.publishedYear,
      releaseDate: item.releaseDate,
      language: item.language,
      unabridged: item.unabridged,
      isbn: item.isbn,
      series: item.series ? { id: item.series.id, name: item.series.name, position: item.seriesPosition } : null,
      genres: item.genres.map((row) => ({
        id: row.genre.id,
        slug: row.genre.slug,
        name: row.genre.name,
        parent: row.genre.parent?.name ?? null,
        source: row.source,
      })),
      contributors: item.contributors.map((row) => ({
        id: row.contributor.id,
        name: row.contributor.name,
        role: row.contributor.role,
      })),
      metadataSource: item.metadataSource,
      enrichmentStatus: item.enrichmentStatus,
      overriddenFields: [...overridden],
    };
  });

  app.put<{ Params: { id: string }; Body: unknown }>("/api/audiobooks/:id/tags", {
    schema: {
      params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
      body: {
        type: "object",
        properties: {
          title: { type: "string", minLength: 1, maxLength: 500 },
          subtitle: { type: "string", maxLength: 500 },
          author: { type: "string", minLength: 1, maxLength: 500 },
          narrator: { type: "string", maxLength: 500 },
          description: { type: "string", maxLength: 4000 },
          publisher: { type: "string", maxLength: 300 },
          publishedYear: { type: "integer", minimum: 0, maximum: 3000 },
          language: { type: "string", maxLength: 50 },
          unabridged: { type: "boolean" },
          isbn: { type: "string", maxLength: 20 },
          seriesName: { type: "string", maxLength: 300 },
          seriesPosition: { type: "number" },
          genreIds: { type: "array", items: { type: "integer", minimum: 1 }, maxItems: 20 },
          tagIds: { type: "array", items: { type: "integer", minimum: 1 }, maxItems: 30 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    if (accountExperience === "demo") return fail(reply, 404, "not_found");
    const id = parseIdParam(request.params.id);
    if (id === null) return fail(reply, 400, "invalid_id");
    const item = await prisma.mediaItem.findUnique({ where: { id } });
    if (!item) return fail(reply, 404, "audiobook_not_found");

    const body = request.body as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    const overrideFields: string[] = [];
    for (const [field, column] of [
      ["title", "title"], ["subtitle", "subtitle"], ["author", "author"], ["narrator", "narrator"],
      ["description", "description"], ["publisher", "publisher"], ["language", "language"], ["isbn", "isbn"],
    ] as const) {
      if (body[field] !== undefined) {
        data[column] = String(body[field]).trim() || null;
        overrideFields.push(field);
      }
    }
    if (body.publishedYear !== undefined) {
      data.publishedYear = body.publishedYear as number;
      overrideFields.push("publishedYear");
    }
    if (body.unabridged !== undefined) {
      data.unabridged = Boolean(body.unabridged);
      overrideFields.push("unabridged");
    }
    if (typeof body.seriesName === "string") {
      const name = body.seriesName.trim();
      if (name) {
        const seriesId = await upsertSeries(prisma, name);
        if (seriesId !== null) data.seriesId = seriesId;
      } else {
        data.seriesId = null;
      }
      overrideFields.push("seriesName");
    }
    if (body.seriesPosition !== undefined) {
      data.seriesPosition = body.seriesPosition as number;
      overrideFields.push("seriesPosition");
    }
    if (Array.isArray(body.genreIds)) {
      const genreIds = body.genreIds as number[];
      if (genreIds.length > 0) {
        const found = await prisma.genre.count({ where: { id: { in: genreIds } } });
        if (found !== genreIds.length) return fail(reply, 400, "unknown_genre_id");
      }
      await prisma.mediaItemGenre.deleteMany({ where: { mediaItemId: id } });
      if (genreIds.length > 0) {
        await prisma.mediaItemGenre.createMany({
          data: genreIds.map((genreId) => ({ mediaItemId: id, genreId, source: "user" })),
        });
      }
    }
    if (Array.isArray(body.tagIds)) {
      const tagIds = [...new Set(body.tagIds as number[])];
      if (tagIds.length > 0) {
        const found = await prisma.tag.count({ where: { id: { in: tagIds } } });
        if (found !== tagIds.length) return fail(reply, 400, "unknown_tag_id");
      }
      await setBookTags(prisma, id, tagIds);
    }

    data.metadataSource = "manual";
    data.enrichmentStatus = "applied";
    await prisma.mediaItem.update({
      where: { id },
      data: data as Prisma.MediaItemUncheckedUpdateInput,
    });

    const before = item as unknown as Record<string, unknown>;
    for (const field of overrideFields) {
      const value = data[field];
      const isEmptyValue = value === null || value === undefined
        || (typeof value === "string" && value.trim() === "") || value === 0;
      const previous = before[field];
      const unchanged = value !== null && value !== undefined && String(value) === String(previous ?? "");
      if (isEmptyValue) {
        await prisma.fieldOverride.deleteMany({ where: { mediaItemId: id, field } });
        continue;
      }
      if (unchanged) continue;
      await prisma.fieldOverride.upsert({
        where: { mediaItemId_field: { mediaItemId: id, field } },
        create: { mediaItemId: id, field, value: String(value) },
        update: { value: String(value) },
      });
    }
    return { ok: true, overriddenFields: overrideFields };
  });

  app.post<{ Params: { id: string } }>("/api/audiobooks/:id/metadata/reset", {
    schema: { params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } },
  }, async (request, reply) => {
    if (accountExperience === "demo") return fail(reply, 404, "not_found");
    const id = parseIdParam(request.params.id);
    if (id === null) return fail(reply, 400, "invalid_id");
    const item = await prisma.mediaItem.findUnique({ where: { id } });
    if (!item) return fail(reply, 404, "audiobook_not_found");
    const { count } = await prisma.fieldOverride.deleteMany({ where: { mediaItemId: id } });
    await prisma.mediaItem.update({
      where: { id },
      data: { enrichmentStatus: "pending", metadataSource: "embedded" },
    });
    return { reset: true, clearedOverrides: count };
  });

  app.post("/api/metadata/reset-all", async () => {
    const { count } = await prisma.fieldOverride.deleteMany({});
    const result = await prisma.mediaItem.updateMany({
      data: { enrichmentStatus: "pending", metadataSource: "embedded" },
    });
    return { reset: true, clearedOverrides: count, booksRequeued: result.count };
  });
}
