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
import { buildQuery, EnrichmentManager } from "./metadata/run";
import { seedGenreMappings, seedGenres, upsertSeries } from "./metadata/taxonomy-service";

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
    const items = await prisma.mediaItem.findMany({ include: { tracks: true, contributors: true } });
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
        ...publicMediaItem(item),
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

  /** Strip server-side filesystem paths before a payload leaves the server. */
  function publicMediaItem<T extends Record<string, unknown>>(item: T): Omit<T, "filePath" | "coverImagePath"> {
    const { filePath: _filePath, coverImagePath: _cover, ...rest } = item;
    return rest as Omit<T, "filePath" | "coverImagePath">;
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

    if (Array.isArray(body.genreIds) && body.genreIds.length > 0) {
      // A user-chosen genre set replaces the provider's entirely, and is
      // recorded with source "user" so enrichment cannot revoke it.
      await prisma.mediaItemGenre.deleteMany({ where: { mediaItemId: id } });
      await prisma.mediaItemGenre.createMany({
        data: (body.genreIds as number[]).map((genreId) => ({ mediaItemId: id, genreId, source: "user" })),
      });
    }

    data.metadataSource = "manual";
    data.enrichmentStatus = "applied";
    await prisma.mediaItem.update({ where: { id }, data });

    // Record the overrides so the scanner and enrichment leave them alone.
    for (const field of overrideFields) {
      const value = data[field];
      await prisma.fieldOverride.upsert({
        where: { mediaItemId_field: { mediaItemId: id, field } },
        create: { mediaItemId: id, field, value: value === null || value === undefined ? "" : String(value) },
        update: { value: value === null || value === undefined ? "" : String(value) },
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
