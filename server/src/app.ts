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
import { COVER_DIR, candidateCoverFilename, downloadCover, searchGoogleBooks, searchOpenLibrary } from "./enrichment";
import { resolveInsideRoot } from "./safePath";

export interface BuildAppOptions {
  prisma?: PrismaClient;
  logger?: boolean;
  appPassword?: string;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const prisma = options.prisma ?? new PrismaClient();
  const app = Fastify({ logger: options.logger ?? true });
  const scanner = createScanManager(prisma);
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

  app.get("/api/audiobooks", async () => {
    return prisma.mediaItem.findMany({ include: { tracks: true, contributors: true } });
  });

  app.get("/api/audiobooks/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const item = await prisma.mediaItem.findUnique({
      where: { id },
      include: { tracks: true, contributors: { include: { contributor: true } } },
    });
    if (!item) return reply.code(404).send({ message: "Audiobook not found" });
    return item;
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
    for (const root of roots) void scanner.scanRoot(root.id).catch((error) => app.log.error(error));
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

  app.post<{ Params: { id: string } }>("/api/audiobooks/:id/enrich", async (request, reply) => {
    const item = await prisma.mediaItem.findUnique({ where: { id: parseIdParam(request.params.id) ?? -1 } });
    if (!item) return reply.code(404).send({ message: "Audiobook not found" });
    const [openLibrary, googleBooks] = await Promise.allSettled([
      searchOpenLibrary(item.title, item.author === "Unknown author" ? undefined : item.author),
      searchGoogleBooks(item.title, item.author === "Unknown author" ? undefined : item.author),
    ]);
    const candidates = [
      ...(openLibrary.status === "fulfilled" ? openLibrary.value : []),
      ...(googleBooks.status === "fulfilled" ? googleBooks.value : []),
    ].sort((a, b) => b.confidence - a.confidence);
    await prisma.metadataCandidate.deleteMany({ where: { mediaItemId: item.id } });
    for (const candidate of candidates) {
      await prisma.metadataCandidate.create({
        data: {
          mediaItemId: item.id,
          source: candidate.source,
          title: candidate.title,
          author: candidate.author,
          coverUrl: candidate.coverUrl,
          description: candidate.description,
          confidence: candidate.confidence,
          raw: JSON.stringify(candidate.raw),
        },
      });
    }
    return candidates;
  });

  app.get<{ Params: { id: string } }>("/api/audiobooks/:id/candidates", async (request, reply) => {
    const id = parseIdParam(request.params.id);
    if (id === null) return reply.code(400).send({ message: "Invalid ID" });
    const item = await prisma.mediaItem.findUnique({ where: { id } });
    if (!item) return reply.code(404).send({ message: "Audiobook not found" });
    return prisma.metadataCandidate.findMany({ where: { mediaItemId: id }, orderBy: { confidence: "desc" } });
  });

  app.post<{ Params: { id: string }; Body: { candidateId?: number; title?: string; author?: string; description?: string; coverUrl?: string } }>("/api/audiobooks/:id/metadata", async (request, reply) => {
    const id = parseIdParam(request.params.id);
    if (id === null) return reply.code(400).send({ message: "Invalid ID" });
    const item = await prisma.mediaItem.findUnique({ where: { id } });
    if (!item) return reply.code(404).send({ message: "Audiobook not found" });

    let data: { title?: string; author?: string; description?: string; coverImagePath?: string | null; coverImageUrl?: string | null } = {};
    if (request.body?.candidateId) {
      const candidate = await prisma.metadataCandidate.findUnique({ where: { id: request.body.candidateId } });
      if (!candidate || candidate.mediaItemId !== id) return reply.code(400).send({ message: "Candidate not found for this book" });
      data = { title: candidate.title, author: candidate.author ?? item.author, description: candidate.description ?? undefined, coverImageUrl: candidate.coverUrl };
      if (candidate.coverUrl) {
        const dest = path.join(COVER_DIR, candidateCoverFilename(candidate.source, candidate.id));
        if (await downloadCover(candidate.coverUrl, dest)) data.coverImagePath = dest;
      }
    } else {
      data = {
        title: request.body?.title?.trim() || undefined,
        author: request.body?.author?.trim() || undefined,
        description: request.body?.description?.trim() || undefined,
        coverImageUrl: request.body?.coverUrl?.trim() || undefined,
      };
      const cover = request.body?.coverUrl?.trim();
      if (cover) {
        const dest = path.join(COVER_DIR, `manual_${id}_${Date.now()}.jpg`);
        if (await downloadCover(cover, dest)) data.coverImagePath = dest;
      }
    }

    const updated = await prisma.mediaItem.update({
      where: { id },
      data: { ...data, metadataSource: "user" },
    });
    return updated;
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
    const row = await prisma.listeningHistory.findFirst({ where: { mediaItemId: item.id, profileId } });
    return { position: row?.position ?? 0, completed: row?.completed ?? false };
  });

  app.put<{ Params: { id: string }; Body: { position?: number; completed?: boolean } }>("/api/audiobooks/:id/progress", async (request, reply) => {
    const profileId = Number(request.headers["x-profile-id"]);
    if (!Number.isInteger(profileId) || profileId < 1) return reply.code(400).send({ message: "A profile is required" });
    const item = await prisma.mediaItem.findUnique({ where: { id: parseIdParam(request.params.id) ?? -1 } });
    if (!item) return reply.code(404).send({ message: "Audiobook not found" });

    const rawPosition = typeof request.body?.position === "number" && Number.isFinite(request.body.position) ? request.body.position : 0;
    const position = Math.min(Math.max(rawPosition, 0), item.duration || rawPosition);
    const completed = request.body?.completed ?? position >= 0.95 * (item.duration || Infinity);

    const existing = await prisma.listeningHistory.findFirst({ where: { mediaItemId: item.id, profileId } });
    if (existing) {
      await prisma.listeningHistory.update({ where: { id: existing.id }, data: { position, completed } });
    } else {
      await prisma.listeningHistory.create({ data: { mediaItemId: item.id, profileId, position, completed } });
    }
    return { position, completed };
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
    const session = await prisma.playSession.create({
      data: {
        profileId,
        mediaItemId: item.id,
        fromPosition: Math.max(0, fromPosition),
        toPosition: Math.max(0, toPosition),
        speed: Number.isFinite(Number(request.body?.speed)) ? Number(request.body?.speed) : 1,
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
