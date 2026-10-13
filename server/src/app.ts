import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { PrismaClient } from "@prisma/client";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import { createScanManager } from "./scanner";
import { LMStudioAdapter } from "./ai/llm";
import { COVER_DIR } from "./enrichment";
import { resolveInsideRoot } from "./safePath";
import { applyCandidate, rowToCandidate, storeCandidates } from "./metadata/apply";
import { coverFilename, fetchCover } from "./metadata/cover";
import { runChain } from "./metadata/chain";
import { trackTitleOverrideField } from "./metadata/chapters";
import { buildQuery, EnrichmentManager } from "./metadata/run";
import { seedGenreMappings, seedGenres, upsertSeries } from "./metadata/taxonomy-service";
import { createTag, mergeTags, renameTag, setBookTags } from "./metadata/tags";
import { RecommendationService } from "./metadata/recommend-service";

export interface BuildAppOptions {
  prisma?: PrismaClient;
  logger?: boolean;
  appPassword?: string;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const prisma = options.prisma ?? new PrismaClient();
  const app = Fastify({ logger: options.logger ?? true });
  const scanner = createScanManager(prisma);
  const enrichment = new EnrichmentManager(prisma);
  const recommendations = new RecommendationService(prisma);
  const appPassword = options.appPassword ?? process.env.APP_PASSWORD;
  const authEnabled = Boolean(appPassword);
  const sessions = new Set<string>();

  function serializeBigInts<T>(value: T): T {
    return JSON.parse(JSON.stringify(value, (_key, nestedValue) => (
      typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue
    ))) as T;
  }

  app.addHook("preSerialization", async (_request, _reply, payload) => serializeBigInts(payload));

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    reply.code(statusCode).send({ message: statusCode === 500 ? "Internal server error" : error.message });
  });

  await app.register(cors, { origin: ["http://localhost:5173", "http://localhost:3000"] });
  await app.register(cookie);

  // Auth gate: health and the login endpoint stay public; everything else
  // requires a valid household session cookie when APP_PASSWORD is set.
  app.addHook("onRequest", async (request, reply) => {
    if (!authEnabled) return;
    const open = request.url === "/api/health" || request.url.startsWith("/api/auth/login");
    if (open) return;
    const token = request.cookies["house_session"];
    if (!token || !sessions.has(token)) {
      return reply.code(401).send({ message: "Authentication required" });
    }
  });

  app.post<{ Body: { password?: string } }>("/api/auth/login", async (request, reply) => {
    const password = request.body?.password;
    if (typeof password !== "string") return reply.code(400).send({ message: "Password must be a string" });
    if (!authEnabled) return { token: "disabled" };
    const expected = Buffer.from(appPassword as string);
    const provided = Buffer.from(password);
    const ok = expected.length === provided.length && timingSafeEqual(expected, provided);
    if (!ok) return reply.code(401).send({ message: "Incorrect password" });
    const token = randomBytes(24).toString("hex");
    sessions.add(token);
    reply.setCookie("house_session", token, { path: "/", httpOnly: true, sameSite: "lax" });
    return { ok: true };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const token = request.cookies["house_session"];
    if (token) sessions.delete(token);
    reply.clearCookie("house_session", { path: "/" });
    return { ok: true };
  });

  function parseIdParam(raw: string | undefined): number | null {
    const id = Number(raw);
    return Number.isInteger(id) && id >= 1 ? id : null;
  }

  app.get("/api/health", async () => ({ status: "ok" }));

  // Serve the built client (production single-origin). In dev the Vite dev
  // server runs separately on :5173, so this only kicks in when client/dist exists.
  const { existsSync } = await import("node:fs");
  const clientDist = process.env.CLIENT_DIST || path.resolve(__dirname, "../../client/dist");
  if (existsSync(clientDist)) {
    const fastifyStatic = (await import("@fastify/static")).default;
    await app.register(fastifyStatic, { root: clientDist, prefix: "/", wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.code(404).send({ message: "Not found" });
      }
      reply.sendFile("index.html");
    });
  }

  // Optional profile header: unlike the progress routes this never 400s, because
  // the library has to render before a profile has been picked. A missing or
  // malformed header simply yields no progress rather than an error.
  function optionalProfileId(request: { headers: Record<string, unknown> }): number | null {
    const profileId = Number(request.headers["x-profile-id"]);
    return Number.isInteger(profileId) && profileId >= 1 ? profileId : null;
  }

  app.get("/api/audiobooks", async (request) => {
    // Spec 20: the browse UI needs genres, series and custom tags on the list
    // payload -- fetching them per-book would be an N+1 request per shelf.
    const items = await prisma.mediaItem.findMany({
      include: {
        tracks: true,
        series: true,
        genres: { include: { genre: true } },
        customTags: { include: { tag: true } },
        contributors: { include: { contributor: true } },
      },
    });
    const profileId = optionalProfileId(request);
    // One query for the whole library's progress rather than one per book.
    const history = profileId === null
      ? []
      : await prisma.listeningHistory.findMany({
        where: { profileId },
        select: { mediaItemId: true, position: true, completed: true, lastPlayed: true },
      });
    const byItem = new Map(history.map((row) => [row.mediaItemId, row]));
    // Spec 14: the grid needs each book's saved position to render
    // "continue listening" without N+1 requests. Scoped to the caller's profile,
    // so one household member never sees another's position.
    return items.map((item) => {
      const row = byItem.get(item.id);
      return {
        // Spec 11: never expose server filesystem paths to a client.
        ...publicMediaItem({
          ...item,
          tracks: item.tracks.map(({ filePath: _trackPath, ...track }) => track),
        }),
        // Flatten the join rows so the client can filter without walking them.
        genres: item.genres.map((link) => ({
          id: link.genre.id,
          slug: link.genre.slug,
          name: link.genre.name,
          parentId: link.genre.parentId,
          source: link.source,
        })),
        customTags: item.customTags.map((link) => ({
          id: link.tag.id,
          name: link.tag.name,
        })),
        contributors: item.contributors.map((link) => ({
          id: link.contributor.id,
          name: link.contributor.name,
          role: link.contributor.role,
        })),
        progress: row
          ? { position: row.position, completed: row.completed, lastPlayed: row.lastPlayed }
          : null,
      };
    });
  });

  app.get<{ Params: { id: string } }>("/api/audiobooks/:id", async (request, reply) => {
    // Number("abc") is NaN, which Prisma turns into a 500. Validate like the
    // other id routes so a bad id is a 400/404, not a server error.
    const id = parseIdParam((request.params as { id: string }).id);
    if (id === null) return reply.code(400).send({ message: "Invalid ID" });
    const item = await prisma.mediaItem.findUnique({
      where: { id },
      include: { tracks: true, contributors: { include: { contributor: true } } },
    });
    if (!item) return reply.code(404).send({ message: "Audiobook not found" });
    // Spec 11: strip filePath / coverImagePath (and track paths) from the payload.
    return publicMediaItem({
      ...item,
      tracks: item.tracks.map(({ filePath: _trackPath, ...track }) => track),
    });
  });

  app.get("/api/library-roots", async () => {
    return prisma.libraryRoot.findMany({ include: { scanState: true }, orderBy: { createdAt: "asc" } });
  });

  app.post<{ Body: { path?: string; label?: string } }>("/api/library-roots", async (request, reply) => {
    const rootPath = request.body.path?.trim();
    if (!rootPath) return reply.code(400).send({ message: "A library path is required" });
    try {
      await access(rootPath);
    } catch {
      return reply.code(400).send({ message: "Library path is not accessible" });
    }
    const root = await prisma.libraryRoot.upsert({
      where: { path: path.resolve(rootPath) },
      create: { path: path.resolve(rootPath), label: request.body.label?.trim() || path.basename(rootPath) },
      update: { label: request.body.label?.trim() || path.basename(rootPath) },
    });
    return reply.code(201).send(root);
  });

  app.delete<{ Params: { id: string } }>("/api/library-roots/:id", async (request, reply) => {
    const id = parseIdParam(request.params.id);
    if (id === null) return reply.code(400).send({ message: "Invalid ID" });
    await prisma.libraryRoot.delete({ where: { id } });
    return reply.code(204).send();
  });

  app.post<{ Body: { rootId?: number } }>("/api/scan", async (request, reply) => {
    const roots = request.body?.rootId
      ? await prisma.libraryRoot.findMany({ where: { id: request.body.rootId } })
      : await prisma.libraryRoot.findMany();
    if (roots.length === 0) return reply.code(400).send({ message: "Add a library root before scanning" });
    for (const root of roots) {
      void scanner
        .scanRoot(root.id)
        .then(async () => {
          // Spec 16: completing a scan automatically kicks off a background
          // enrichment pass. Failures here must never affect the scan result.
          try {
            const status = await enrichment.enqueue();
            app.log.info({ enrichment: status }, "scan finished, enrichment enqueued");
          } catch (error) {
            app.log.error({ error }, "failed to enqueue enrichment after scan");
          }
        })
        .catch((error) => app.log.error(error));
    }
    return reply.code(202).send({ status: "started", rootIds: roots.map((root) => root.id) });
  });

  app.get("/api/scan/status", async () => {
    const roots = await prisma.libraryRoot.findMany({ include: { scanState: true }, orderBy: { id: "asc" } });
    return roots.map((root) => ({
      rootId: root.id,
      path: root.path,
      status: scanner.getProgress(root.id) || root.scanState || { status: "idle", filesFound: 0 },
    }));
  });

  app.get<{ Params: { id: string } }>("/api/audiobooks/:id/cover", async (request, reply) => {
    const item = await prisma.mediaItem.findUnique({
      where: { id: parseIdParam(request.params.id) ?? -1 },
      include: { libraryRoot: true },
    });
    if (!item?.coverImagePath) return reply.code(404).send({ message: "Cover not found" });
    // Covers may legitimately live in the app covers dir OR beside the media,
    // so allow both roots.
    const allowed = [item.libraryRoot.path, COVER_DIR].some((root) => resolveInsideRoot(item.coverImagePath as string, root) !== null);
    if (!allowed) return reply.code(403).send({ message: "Forbidden" });
    try {
      await access(item.coverImagePath);
    } catch {
      return reply.code(404).send({ message: "Cover not found" });
    }
    reply.type(`image/${path.extname(item.coverImagePath).slice(1) || "jpeg"}`);
    return reply.send(createReadStream(item.coverImagePath));
  });

  app.get<{ Params: { id: string } }>("/api/audiobooks/:id/stream", async (request, reply) => {
    const item = await prisma.mediaItem.findUnique({
      where: { id: parseIdParam(request.params.id) ?? -1 },
      include: { libraryRoot: true },
    });
    if (!item) return reply.code(404).send({ message: "Audiobook not found" });
    if (resolveInsideRoot(item.filePath, item.libraryRoot.path) === null) {
      return reply.code(403).send({ message: "Forbidden" });
    }
    try {
      return await streamAudioFile(item.filePath, request.headers.range, reply);
    } catch {
      return reply.code(404).send({ message: "Audio file not found" });
    }
  });

  app.get<{ Params: { id: string } }>("/api/tracks/:id/stream", async (request, reply) => {
    const id = parseIdParam(request.params.id);
    if (id === null) return reply.code(400).send({ message: "Invalid ID" });
    if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ message: "Invalid track ID" });
    const track = await prisma.track.findUnique({
      where: { id },
      include: { mediaItem: { include: { libraryRoot: true } } },
    });
    if (!track) return reply.code(404).send({ message: "Track not found" });
    if (resolveInsideRoot(track.filePath, track.mediaItem.libraryRoot.path) === null) {
      return reply.code(403).send({ message: "Forbidden" });
    }
    try {
      return await streamAudioFile(track.filePath, request.headers.range, reply);
    } catch {
      return reply.code(404).send({ message: "Audio file not found" });
    }
  });

  // ---------------------------------------------------------------------
  // Spec 16 — metadata enrichment
  // ---------------------------------------------------------------------

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

  /** Strip server-side filesystem paths before a payload leaves the server. */
  function publicMediaItem<T extends Record<string, unknown>>(item: T): Omit<T, "filePath" | "coverImagePath"> {
    const { filePath: _filePath, coverImagePath: _cover, ...rest } = item;
    return rest as Omit<T, "filePath" | "coverImagePath">;
  }

  function decodeJsonList(value: string | null): string[] {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
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
 * external providers), so there is nothing to strip -- but returning the
 * result unchanged here keeps that guarantee explicit and easy to enforce if a
 * future change starts caching covers locally.
 */
  function publicRecommendations<T>(result: T): T {
    return result;
  }

  app.post<{ Params: { id: string } }>("/api/audiobooks/:id/enrich", {
    schema: {
      params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    },
  }, async (request, reply) => {
    const id = parseIdParam(request.params.id);
    if (id === null) return reply.code(400).send({ message: "Invalid ID" });
    const item = await prisma.mediaItem.findUnique({ where: { id } });
    if (!item) return reply.code(404).send({ message: "Audiobook not found" });

    // Manual single-book path: run the chain now rather than enqueueing, so
    // the spec 07 "candidates appear" behaviour still holds synchronously.
    const result = await runChain(buildQuery(item), { collectAll: true });
    await storeCandidates(prisma, id, result.candidates);

    // `raw` is large and belongs in the DB for debugging, not in a response.
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
  }, async (request) => {
    const body = (request.body ?? {}) as { mediaItemId?: number; force?: boolean };
    return enrichment.enqueue({ mediaItemId: body.mediaItemId, force: body.force });
  });

  app.get("/api/enrichment/status", async () => enrichment.status());

  /** The spec 16 review queue: everything below the auto-apply threshold. */
  app.get("/api/enrichment/review-queue", async () => {
    const items = await prisma.mediaItem.findMany({
      where: { enrichmentStatus: "review" },
      orderBy: { updatedAt: "desc" },
    });
    return items.map(publicMediaItem);
  });

  app.get<{ Params: { id: string } }>("/api/audiobooks/:id/candidates", {
    schema: {
      params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    },
  }, async (request, reply) => {
    const id = parseIdParam(request.params.id);
    if (id === null) return reply.code(400).send({ message: "Invalid ID" });
    const item = await prisma.mediaItem.findUnique({ where: { id } });
    if (!item) return reply.code(404).send({ message: "Audiobook not found" });
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
    const id = parseIdParam(request.params.id);
    if (id === null) return reply.code(400).send({ message: "Invalid ID" });
    const item = await prisma.mediaItem.findUnique({ where: { id } });
    if (!item) return reply.code(404).send({ message: "Audiobook not found" });

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
        return reply.code(400).send({ message: "Candidate not found for this book" });
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

  app.get("/api/genres", async () => {
    const genres = await prisma.genre.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { _count: { select: { items: true } } },
    });
    const byId = new Map(genres.map((genre) => [genre.id, genre]));
    // Build the two-level tree in one pass so the client does not have to.
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
    const body = request.body as { slug: string; name: string; parentId?: number; sortOrder?: number };
    const existing = await prisma.genre.findUnique({ where: { slug: body.slug } });
    if (existing) return reply.code(409).send({ message: "A genre with that slug already exists" });
    if (body.parentId) {
      const parent = await prisma.genre.findUnique({ where: { id: body.parentId } });
      if (!parent) return reply.code(400).send({ message: "Parent genre not found" });
    }
    return prisma.genre.create({ data: body });
  });

  app.patch<{ Params: { id: string } }>("/api/genres/:id", {
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
    const id = parseIdParam(request.params.id);
    if (id === null) return reply.code(400).send({ message: "Invalid ID" });
    const genre = await prisma.genre.findUnique({ where: { id } });
    if (!genre) return reply.code(404).send({ message: "Genre not found" });
    return prisma.genre.update({ where: { id }, data: request.body as Record<string, unknown> });
  });

  app.delete<{ Params: { id: string } }>("/api/genres/:id", {
    schema: { params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } },
  }, async (request, reply) => {
    const id = parseIdParam(request.params.id);
    if (id === null) return reply.code(400).send({ message: "Invalid ID" });
    const genre = await prisma.genre.findUnique({ where: { id } });
    if (!genre) return reply.code(404).send({ message: "Genre not found" });
    // The catch-all bucket is load-bearing: unmapped provider genres land
    // there. Removing it would silently discard genres on the next pass.
    if (genre.isCatchAll) return reply.code(409).send({ message: "The catch-all genre cannot be deleted" });
    await prisma.genre.delete({ where: { id } });
    return { deleted: true };
  });

  /** The full tag suite for one book, with each field's provenance. */
  app.get<{ Params: { id: string } }>("/api/audiobooks/:id/tags", {
    schema: { params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } },
  }, async (request, reply) => {
    const id = parseIdParam(request.params.id);
    if (id === null) return reply.code(400).send({ message: "Invalid ID" });
    const item = await prisma.mediaItem.findUnique({
      where: { id },
      include: {
        series: true,
        genres: { include: { genre: { include: { parent: true } } } },
        overrides: true,
        contributors: { include: { contributor: true } },
      },
    });
    if (!item) return reply.code(404).send({ message: "Audiobook not found" });

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

  /** Edit the tag suite. Any field present becomes a user override (ADR 009). */
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
    const id = parseIdParam(request.params.id);
    if (id === null) return reply.code(400).send({ message: "Invalid ID" });
    const item = await prisma.mediaItem.findUnique({ where: { id } });
    if (!item) return reply.code(404).send({ message: "Audiobook not found" });

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
          return reply.code(400).send({ message: "Unknown genre id" });
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
        if (found !== tagIds.length) return reply.code(400).send({ message: "Unknown tag id" });
      }
      await setBookTags(prisma, id, tagIds);
    }

    data.metadataSource = "manual";
    data.enrichmentStatus = "applied";
    await prisma.mediaItem.update({ where: { id }, data });

    // Record the overrides so the scanner and enrichment leave them alone.
    //
    // Two rules, both of which exist because a bug once wrote an override for
    // every field on save:
    //  - only fields the request actually sent become overrides (the client
    //    now sends only changed fields, but the server must not rely on it);
    //  - a field cleared to empty is *removed* as an override rather than
    //    stored as "". An empty override blocks the scanner from ever filling
    //    that field in, which is the opposite of what clearing it means, and
    //    a numeric zero is likewise not a user-chosen value.
    // Compare against the row as it was *before* this update. Re-reading it after
    // the write would make every field look unchanged and silently record no
    // override at all, which is how a confirmed edit stops being protected.
    const before = item as unknown as Record<string, unknown>;
    for (const field of overrideFields) {
      const value = data[field];
      const isEmptyValue =
        value === null || value === undefined || (typeof value === "string" && value.trim() === "") || value === 0;
      const previous = before[field];
      const unchanged = value !== null && value !== undefined && String(value) === String(previous ?? "");

      if (isEmptyValue) {
        // Clearing a field releases the override so the scanner may fill it in.
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

  /**
   * Spec 17 reset. Clears user overrides so the scanner and enrichment can
   * write those fields again. This is the escape hatch for a bad mass rewrite.
   */
  app.post<{ Params: { id: string } }>("/api/audiobooks/:id/metadata/reset", {
    schema: { params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } },
  }, async (request, reply) => {
    const id = parseIdParam(request.params.id);
    if (id === null) return reply.code(400).send({ message: "Invalid ID" });
    const item = await prisma.mediaItem.findUnique({ where: { id } });
    if (!item) return reply.code(404).send({ message: "Audiobook not found" });

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
      if (id === null) return reply.code(400).send({ message: "Invalid ID" });
      const trackNumber = Number(request.params.trackNumber);
      if (!Number.isInteger(trackNumber) || trackNumber < 1) {
        return reply.code(400).send({ message: "Invalid track number" });
      }

      const item = await prisma.mediaItem.findUnique({ where: { id }, select: { id: true } });
      if (!item) return reply.code(404).send({ message: "Audiobook not found" });

      const track = await prisma.track.findFirst({ where: { mediaItemId: id, trackNumber } });
      if (!track) return reply.code(404).send({ message: "Track not found" });

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

  // ---------------------------------------------------------------------
  // Spec 18 — favourites & custom tags
  // ---------------------------------------------------------------------

  /** Every metadata route requires a profile; favourites are per profile. */
  function requireProfileId(request: { headers: Record<string, unknown> }): number | null {
    const profileId = Number(request.headers["x-profile-id"]);
    return Number.isInteger(profileId) && profileId > 0 ? profileId : null;
  }

  app.put<{ Params: { id: string } }>("/api/audiobooks/:id/favourite", {
    schema: { params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } },
  }, async (request, reply) => {
    const profileId = requireProfileId(request);
    if (profileId === null) return reply.code(400).send({ message: "A profile is required" });
    const id = parseIdParam(request.params.id);
    if (id === null) return reply.code(400).send({ message: "Invalid ID" });
    const item = await prisma.mediaItem.findUnique({ where: { id }, select: { id: true } });
    if (!item) return reply.code(404).send({ message: "Audiobook not found" });

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
    if (profileId === null) return reply.code(400).send({ message: "A profile is required" });
    const id = parseIdParam(request.params.id);
    if (id === null) return reply.code(400).send({ message: "Invalid ID" });

    // Un-favouriting something already un-favourited is a no-op.
    const { count } = await prisma.favourite.deleteMany({ where: { profileId, mediaItemId: id } });
    return { favourited: false, removed: count };
  });

  app.get("/api/favourites", async (request, reply) => {
    const profileId = requireProfileId(request);
    if (profileId === null) return reply.code(400).send({ message: "A profile is required" });

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

    return favourites.map((row) => ({
      favouritedAt: row.createdAt,
      book: publicMediaItem({
        ...row.mediaItem,
        tracks: [],
        contributors: row.mediaItem.contributors.map((link) => link.contributor),
      }),
    }));
  });

  /** The current profile's favourites, as a plain id set for list endpoints. */
  app.get("/api/favourites/ids", async (request, reply) => {
    const profileId = requireProfileId(request);
    if (profileId === null) return reply.code(400).send({ message: "A profile is required" });
    const rows = await prisma.favourite.findMany({ where: { profileId }, select: { mediaItemId: true } });
    return rows.map((row) => row.mediaItemId);
  });

  app.get("/api/tags", async () => {
    const tags = await prisma.tag.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { items: true } } },
    });
    // Counts come from the same rows the UI lists, so a count can never
    // disagree with the number of books behind it.
    return tags.map((tag) => ({ id: tag.id, name: tag.name, count: tag._count.items }));
  });

  app.post("/api/tags", {
    schema: {
      body: {
        type: "object",
        properties: { name: { type: "string", minLength: 1, maxLength: 100 } },
        required: ["name"],
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const body = request.body as { name: string };
    const result = await createTag(prisma, body.name, optionalProfileId(request));
    if ("reason" in result) return reply.code(409).send({ message: `Tag name rejected: ${result.reason}` });
    return reply.code(result.created ? 201 : 200).send(result.tag);
  });

  app.patch<{ Params: { id: string } }>("/api/tags/:id", {
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
    const id = parseIdParam(request.params.id);
    if (id === null) return reply.code(400).send({ message: "Invalid ID" });
    const result = await renameTag(prisma, id, (request.body as { name: string }).name);
    if ("reason" in result) return reply.code(409).send({ message: `Tag name rejected: ${result.reason}` });
    return result.tag;
  });

  app.delete<{ Params: { id: string } }>("/api/tags/:id", {
    schema: { params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } },
  }, async (request, reply) => {
    const id = parseIdParam(request.params.id);
    if (id === null) return reply.code(400).send({ message: "Invalid ID" });
    const tag = await prisma.tag.findUnique({ where: { id } });
    if (!tag) return reply.code(404).send({ message: "Tag not found" });
    // Cascades to MediaItemTag, so every assignment goes with it.
    await prisma.tag.delete({ where: { id } });
    return { deleted: true };
  });

  app.post<{ Params: { id: string } }>("/api/tags/:id/merge", {
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
    const id = parseIdParam(request.params.id);
    if (id === null) return reply.code(400).send({ message: "Invalid ID" });
    const { targetTagId } = request.body as { targetTagId: number };
    const result = await mergeTags(prisma, id, targetTagId);
    if ("reason" in result) {
      const status = result.reason === "not-found" ? 404 : 400;
      return reply.code(status).send({ message: `Merge failed: ${result.reason}` });
    }
    // The count is reported so the UI can confirm how many books moved.
    return { moved: result.moved, mergedInto: targetTagId };
  });

  // ---------------------------------------------------------------------
  // Spec 19 — Discover & wishlist
  // ---------------------------------------------------------------------

  app.get<{ Params: { id: string } }>("/api/discover/similar/:id", {
    schema: {
      params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
      querystring: {
        type: "object",
        properties: { limit: { type: "integer", minimum: 1, maximum: 50 } },
      },
    },
  }, async (request, reply) => {
    const id = parseIdParam(request.params.id);
    if (id === null) return reply.code(400).send({ message: "Invalid ID" });
    const exists = await prisma.mediaItem.findUnique({ where: { id }, select: { id: true } });
    if (!exists) return reply.code(404).send({ message: "Audiobook not found" });

    const limit = (request.query as { limit?: number }).limit ?? 20;
    const result = await recommendations.similarTo(id, limit);
    return publicRecommendations(result);
  });

  app.get("/api/discover/for-me", async (request, reply) => {
    const profileId = requireProfileId(request);
    if (profileId === null) return reply.code(400).send({ message: "A profile is required" });
    const limit = Number((request.query as { limit?: string }).limit ?? 20);
    const result = await recommendations.forProfile(profileId, Number.isFinite(limit) ? limit : 20);
    return publicRecommendations(result);
  });

  app.get("/api/wishlist", async (request, reply) => {
    const profileId = requireProfileId(request);
    if (profileId === null) return reply.code(400).send({ message: "A profile is required" });
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
    if (profileId === null) return reply.code(400).send({ message: "A profile is required" });
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
      { ...body, narrators: body.narrators ?? [], genres: body.genres ?? [], score: 0, reason: "" },
      body.seedMediaItemId,
    );
    return reply.code(201).send(publicWishlistItem(item));
  });

  app.delete<{ Params: { id: string } }>("/api/wishlist/:id", {
    schema: { params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } },
  }, async (request, reply) => {
    const profileId = requireProfileId(request);
    if (profileId === null) return reply.code(400).send({ message: "A profile is required" });
    const id = parseIdParam(request.params.id);
    if (id === null) return reply.code(400).send({ message: "Invalid ID" });

    // Scoped by profile: one profile cannot delete another's wishlist entry.
    const { count } = await prisma.wishlistItem.deleteMany({ where: { id, profileId } });
    if (count === 0) return reply.code(404).send({ message: "Wishlist item not found" });
    return { deleted: true };
  });

  app.put<{ Params: { id: string } }>("/api/wishlist/:id/owned", {
    schema: { params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } },
  }, async (request, reply) => {
    const profileId = requireProfileId(request);
    if (profileId === null) return reply.code(400).send({ message: "A profile is required" });
    const id = parseIdParam(request.params.id);
    if (id === null) return reply.code(400).send({ message: "Invalid ID" });
    const owned = (request.body as { owned?: boolean } | undefined)?.owned ?? true;

    const result = await prisma.wishlistItem.updateMany({ where: { id, profileId }, data: { owned } });
    if (result.count === 0) return reply.code(404).send({ message: "Wishlist item not found" });
    const item = await prisma.wishlistItem.findUnique({ where: { id } });
    return publicWishlistItem(item!);
  });

  // AI: optional metadata match assistant (works only if LM Studio is up)
  app.post<{ Params: { id: string } }>("/api/audiobooks/:id/ai-suggest", async (request, reply) => {
    const id = parseIdParam(request.params.id);
    if (id === null) return reply.code(400).send({ message: "Invalid ID" });
    const item = await prisma.mediaItem.findUnique({ where: { id } });
    if (!item) return reply.code(404).send({ message: "Audiobook not found" });
    const adapter = new LMStudioAdapter();
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

  // Progress (profile-scoped)
  app.get<{ Params: { id: string } }>("/api/audiobooks/:id/progress", async (request, reply) => {
    const profileId = Number(request.headers["x-profile-id"]);
    if (!Number.isInteger(profileId) || profileId < 1) return reply.code(400).send({ message: "A profile is required" });
    const item = await prisma.mediaItem.findUnique({ where: { id: parseIdParam(request.params.id) ?? -1 } });
    if (!item) return reply.code(404).send({ message: "Audiobook not found" });
    const row = await prisma.listeningHistory.findFirst({
      where: { mediaItemId: item.id, profileId },
      orderBy: { lastPlayed: "desc" },
    });
    return { position: row?.position ?? 0, completed: row?.completed ?? false };
  });

  app.put<{ Params: { id: string }; Body: { position?: number; completed?: boolean } }>("/api/audiobooks/:id/progress", async (request, reply) => {
    const profileId = Number(request.headers["x-profile-id"]);
    if (!Number.isInteger(profileId) || profileId < 1) return reply.code(400).send({ message: "A profile is required" });
    const item = await prisma.mediaItem.findUnique({ where: { id: parseIdParam(request.params.id) ?? -1 } });
    if (!item) return reply.code(404).send({ message: "Audiobook not found" });

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

  app.post<{ Params: { id: string }; Body: { fromPosition?: number; toPosition?: number; speed?: number; startedAt?: string; endedAt?: string } }>("/api/audiobooks/:id/sessions", async (request, reply) => {
    const profileId = Number(request.headers["x-profile-id"]);
    if (!Number.isInteger(profileId) || profileId < 1) return reply.code(400).send({ message: "A profile is required" });
    const item = await prisma.mediaItem.findUnique({ where: { id: parseIdParam(request.params.id) ?? -1 } });
    if (!item) return reply.code(404).send({ message: "Audiobook not found" });
    const toPosition = Number(request.body?.toPosition);
    const fromPosition = Number(request.body?.fromPosition);
    if (!Number.isFinite(toPosition) || !Number.isFinite(fromPosition)) {
      return reply.code(400).send({ message: "fromPosition and toPosition are required" });
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
    return reply.code(201).send(session);
  });

  app.get("/api/history", async (request, reply) => {
    const profileId = Number(request.headers["x-profile-id"]);
    if (!Number.isInteger(profileId) || profileId < 1) return reply.code(400).send({ message: "A profile is required" });
    return prisma.playSession.findMany({ where: { profileId }, orderBy: { startedAt: "desc" }, take: 100 });
  });

  // Profiles
  app.get("/api/profiles", async () => prisma.profile.findMany({ orderBy: { createdAt: "asc" } }));

  app.post<{ Body: { name?: string; color?: string } }>("/api/profiles", async (request, reply) => {
    const name = request.body?.name?.trim();
    if (!name) return reply.code(400).send({ message: "A profile name is required" });
    const existing = await prisma.profile.findUnique({ where: { name } });
    if (existing) return reply.code(409).send({ message: "A profile with that name already exists" });
    const profile = await prisma.profile.create({ data: { name, color: request.body?.color?.trim() || null } });
    return reply.code(201).send(profile);
  });

  app.delete<{ Params: { id: string } }>("/api/profiles/:id", async (request, reply) => {
    await prisma.profile.delete({ where: { id: parseIdParam(request.params.id) ?? -1 } });
    return reply.code(204).send();
  });

  return app;
}

async function streamAudioFile(filePath: string, range: string | undefined, reply: import("fastify").FastifyReply) {
  const details = await stat(filePath);
  reply.header("Accept-Ranges", "bytes").type("audio/mpeg");
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
