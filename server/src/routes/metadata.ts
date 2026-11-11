/**
 * The "edit one book" surface: enrichment candidates, metadata confirm,
 * reset, the tag suite, per-track title overrides and the optional AI
 * suggestion. Everything here honours per-field overrides (ADR 009).
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { fail } from "../http-errors";
import { isDemoMode, type AccountExperience } from "../auth/demo-policy";
import { LMStudioAdapter, type LLMAdapter } from "../ai/llm";
import { applyCandidate, rowToCandidate } from "../metadata/apply";
import { decideOverrideAction } from "../metadata/precedence";
import { coverFilename, fetchCover } from "../metadata/cover";
import { trackTitleOverrideField } from "../metadata/chapters";
import { upsertSeries } from "../metadata/taxonomy-service";
import { setBookTags } from "../metadata/tags";
import { publicMediaItem } from "../book-payload";

export interface MetadataRouteDeps {
  prisma: PrismaClient;
  accountExperience: AccountExperience;
  parseIdParam: (raw: string | undefined) => number | null;
  canReadMediaItem: (request: FastifyRequest, mediaItemId: number) => Promise<boolean>;
  /** Injected in tests; production falls back to the real LM Studio adapter. */
  llm?: LLMAdapter;
}

/**
 * Maps an `applyCandidate` field name to the MediaItem column it wrote.
 * Only columns a user-confirmed candidate can legitimately own are listed;
 * `genres`/`contributors` are relational and managed separately.
 */
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

export async function registerMetadataRoutes(
  app: FastifyInstance,
  deps: MetadataRouteDeps,
): Promise<void> {
  const { prisma, accountExperience, parseIdParam, canReadMediaItem, llm } = deps;

  // ---------------------------------------------------------------------
  // Spec 16 — metadata enrichment (the review/accept surface)
  // ---------------------------------------------------------------------

  app.get<{ Params: { id: string } }>("/api/audiobooks/:id/candidates", {
    schema: {
      params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    },
  }, async (request, reply) => {
    if (isDemoMode(accountExperience)) return fail(reply, 404, "not_found");
    const id = parseIdParam(request.params.id);
    if (id === null) return fail(reply, 400, "invalid_id");
    const item = await prisma.mediaItem.findUnique({ where: { id } });
    if (!item) return fail(reply, 404, "audiobook_not_found");
    const rows = await prisma.metadataCandidate.findMany({
      where: { mediaItemId: id },
      orderBy: { confidence: "desc" },
    });
    // Spec 11: `raw` is provider payload, not client data. `providerKey` is
    // internal too. Neither belongs in an API response.
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
    if (isDemoMode(accountExperience)) return fail(reply, 404, "not_found");
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
      if (!candidate || candidate.mediaItemId !== id) {
        return fail(reply, 400, "candidate_not_found");
      }
      const applied = await applyCandidate(prisma, item, rowToCandidate(candidate));
      if (applied.coverImagePath) data.coverImagePath = applied.coverImagePath;
      // Confirming a candidate clears the review-queue flag for this book.
      data.enrichmentStatus = "applied";
      data.enrichedAt = new Date();
      // A confirmed candidate is user-chosen, so it is authoritative.
      data.metadataSource = "manual";

      // Record real per-field overrides for exactly what was applied. This is
      // what lets `manual` drop out of the scanner's blanket legacy lock: a
      // confirmed candidate protects the fields it set, and nothing else.
      const refreshed = await prisma.mediaItem.findUnique({ where: { id } });
      for (const field of applied.fields) {
        const column = CANDIDATE_OVERRIDE_COLUMNS[field] ?? field;
        if (!column) continue;
        const value = refreshed ? (refreshed as Record<string, unknown>)[column] : undefined;
        const action = decideOverrideAction(field, value);
        if (action.action === "upsert") {
          await prisma.fieldOverride.upsert({
            where: { mediaItemId_field: { mediaItemId: id, field } },
            create: { mediaItemId: id, field, value: action.value },
            update: { value: action.value },
          });
        } else if (action.action === "delete") {
          await prisma.fieldOverride.deleteMany({ where: { mediaItemId: id, field } });
        }
      }
    } else {
      if (body.title !== undefined) data.title = body.title.trim();
      if (body.author !== undefined) data.author = body.author.trim();
      if (body.narrator !== undefined) data.narrator = body.narrator.trim() || null;
      if (body.description !== undefined) data.description = body.description.trim() || null;
      data.metadataSource = "manual";

      // Cover URLs arrive from a client, so they go through the hardened,
      // SSRF-aware downloader rather than a raw fetch.
      if (body.coverUrl) {
        const result = await fetchCover(body.coverUrl.trim(), coverFilename("manual", `${id}-${Date.now()}`));
        if (result.ok && result.path) data.coverImagePath = result.path;
      }
    }

    const updated = await prisma.mediaItem.update({ where: { id }, data });
    return publicMediaItem(updated);
  });

  // ---------------------------------------------------------------------
  // Spec 17 — taxonomy, tag suite, per-field overrides
  // ---------------------------------------------------------------------

  /** The full tag suite for one book, with each field's provenance. */
  app.get<{ Params: { id: string } }>("/api/audiobooks/:id/tags", {
    schema: { params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } },
  }, async (request, reply) => {
    if (isDemoMode(accountExperience) && request.auth?.session.profileId == null) return fail(reply, 404, "not_found");
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
    if (isDemoMode(accountExperience) && !(await canReadMediaItem(request, item.id))) return fail(reply, 404, "audiobook_not_found");

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
      // Which fields a human has set, so the UI can show which values are theirs.
      overriddenFields: [...overridden],
    };
  });

  /**
   * Edit the tag suite. Any field present becomes a user override (ADR 009).
   *
   * One route for the whole suite (spec 17 + spec 18): the detail screen saves
   * once, and mixing it with separate per-concern routes made it possible to
   * half-apply an edit.
   */
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
          // Spec 18: the book's custom tags, saved with everything else.
          tagIds: { type: "array", items: { type: "integer", minimum: 1 }, maxItems: 30 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    if (isDemoMode(accountExperience)) return fail(reply, 404, "not_found");
    const id = parseIdParam(request.params.id);
    if (id === null) return fail(reply, 400, "invalid_id");
    const item = await prisma.mediaItem.findUnique({ where: { id } });
    if (!item) return fail(reply, 404, "audiobook_not_found");

    const body = request.body as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    const overrideFields: string[] = [];

    for (const [field, column] of [
      ["title", "title"],
      ["subtitle", "subtitle"],
      ["author", "author"],
      ["narrator", "narrator"],
      ["description", "description"],
      ["publisher", "publisher"],
      ["language", "language"],
      ["isbn", "isbn"],
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
      const trimmed = body.seriesName.trim();
      if (trimmed) {
        const seriesId = await upsertSeries(prisma, trimmed);
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
      if (body.genreIds.length > 0) {
        const found = await prisma.genre.count({ where: { id: { in: body.genreIds as number[] } } });
        if (found !== (body.genreIds as number[]).length) {
          return fail(reply, 400, "unknown_genre_id");
        }
      }
      // A user-chosen genre set replaces the provider's entirely, and is
      // recorded with source "user" so enrichment cannot revoke it.
      await prisma.mediaItemGenre.deleteMany({ where: { mediaItemId: id } });
      if ((body.genreIds as number[]).length > 0) {
        await prisma.mediaItemGenre.createMany({
          data: (body.genreIds as number[]).map((genreId) => ({ mediaItemId: id, genreId, source: "user" })),
        });
      }
    }

    // Spec 18: custom tags. User data, so no override row is needed and
    // enrichment never touches these.
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
    await prisma.mediaItem.update({ where: { id }, data });

    // Record the overrides so the scanner and enrichment leave them alone.
    const before = item as unknown as Record<string, unknown>;
    for (const field of overrideFields) {
      const value = data[field];
      const previous = before[field];
      const action = decideOverrideAction(field, value, previous);
      if (action.action === "delete") {
        await prisma.fieldOverride.deleteMany({ where: { mediaItemId: id, field } });
      } else if (action.action === "upsert") {
        await prisma.fieldOverride.upsert({
          where: { mediaItemId_field: { mediaItemId: id, field } },
          create: { mediaItemId: id, field, value: action.value },
          update: { value: action.value },
        });
      }
    }

    return { ok: true, overriddenFields: overrideFields };
  });

  /**
   * Spec 17 reset. Clears user overrides so the scanner and enrichment can
   * write those fields again. This is the escape hatch for a bad mass rewrite.
   */
  app.post<{ Params: { id: string } }>("/api/audiobooks/:id/metadata/reset", {
    schema: { params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } },
  }, async (request, reply) => {
    if (isDemoMode(accountExperience)) return fail(reply, 404, "not_found");
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

  /**
   * Spec 21 — set or clear one chapter title by hand.
   *
   * This is what makes "a user-set track title is never overwritten" a real
   * guarantee rather than an aspiration: the title is recorded as a
   * `FieldOverride` (ADR 009), which both the scanner and `applyChapterTitles`
   * consult, and which the spec 17 reset endpoints already clear.
   *
   * Keyed by track *number*, not track id -- the scanner recreates track rows on
   * every rescan, so an id-keyed override would be orphaned immediately.
   */
  app.put<{ Params: { id: string; trackNumber: string }; Body: { title?: unknown } }>(
    "/api/audiobooks/:id/tracks/:trackNumber/title",
    {
      schema: {
        params: {
          type: "object",
          properties: { id: { type: "integer" }, trackNumber: { type: "integer", minimum: 1 } },
          required: ["id", "trackNumber"],
        },
        body: {
          type: "object",
          properties: { title: { type: ["string", "null"], maxLength: 500 } },
        },
      },
    },
    async (request, reply) => {
      const id = parseIdParam(request.params.id);
      if (id === null) return fail(reply, 400, "invalid_id");
      const trackNumber = Number(request.params.trackNumber);
      if (!Number.isInteger(trackNumber) || trackNumber < 1) {
        return fail(reply, 400, "invalid_track_number");
      }

      const item = await prisma.mediaItem.findUnique({ where: { id }, select: { id: true } });
      if (!item) return fail(reply, 404, "audiobook_not_found");

      const track = await prisma.track.findFirst({ where: { mediaItemId: id, trackNumber } });
      if (!track) return fail(reply, 404, "track_not_found");

      const field = trackTitleOverrideField(trackNumber);
      const raw = (request.body as { title?: unknown } | undefined)?.title;
      const title = typeof raw === "string" ? raw.trim() : null;

      // Clearing releases the override and restores whatever the file's own tags
      // say. Storing "" instead would block the scanner from ever filling the
      // chapter in again -- the same trap the metadata route documents.
      if (title === null || title.length === 0) {
        await prisma.fieldOverride.deleteMany({ where: { mediaItemId: id, field } });
        return { ok: true, trackNumber, title: null, overridden: false };
      }

      await prisma.fieldOverride.upsert({
        where: { mediaItemId_field: { mediaItemId: id, field } },
        create: { mediaItemId: id, field, value: title },
        update: { value: title },
      });
      await prisma.track.update({ where: { id: track.id }, data: { title } });

      return { ok: true, trackNumber, title, overridden: true };
    },
  );

  // AI: optional metadata match assistant (works only if LM Studio is up)
  app.post<{ Params: { id: string } }>("/api/audiobooks/:id/ai-suggest", async (request, reply) => {
    if (isDemoMode(accountExperience)) return fail(reply, 404, "not_found");
    const id = parseIdParam(request.params.id);
    if (id === null) return fail(reply, 400, "invalid_id");
    const item = await prisma.mediaItem.findUnique({ where: { id } });
    if (!item) return fail(reply, 404, "audiobook_not_found");
    const adapter: LLMAdapter = llm ?? new LMStudioAdapter();
    if (!(await adapter.available())) {
      return { available: false, suggestion: null };
    }
    const candidates = await prisma.metadataCandidate.findMany({ where: { mediaItemId: id }, orderBy: { confidence: "desc" }, take: 5 });
    if (candidates.length === 0) return { available: true, suggestion: null };
    const prompt = `Embedded metadata: title="${item.title}", author="${item.author}", path="${item.filePath}".\nCandidates:\n${candidates.map((c, i) => `${i + 1}. ${c.title} — ${c.author ?? "unknown"} (${c.source})`).join("\n")}\nReply with just the number of the best match, or 0 for none.`;
    const answer = await adapter.chat([{ role: "user", content: prompt }]).catch(() => "");
    const pick = Number(answer.trim().match(/\d+/)?.[0]);
    const suggestion = pick >= 1 && pick <= candidates.length ? candidates[pick - 1] : null;
    return { available: true, suggestion };
  });
}
