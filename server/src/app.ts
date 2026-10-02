import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { PrismaClient } from "@prisma/client";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import { createScanManager } from "./scanner";

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
    const password = request.body?.password ?? "";
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

  app.get("/api/health", async () => ({ status: "ok" }));

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
    const id = Number(request.params.id);
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
    const item = await prisma.mediaItem.findUnique({ where: { id: Number(request.params.id) } });
    if (!item?.coverImagePath) return reply.code(404).send({ message: "Cover not found" });
    try {
      await access(item.coverImagePath);
    } catch {
      return reply.code(404).send({ message: "Cover not found" });
    }
    reply.type(`image/${path.extname(item.coverImagePath).slice(1) || "jpeg"}`);
    return reply.send(createReadStream(item.coverImagePath));
  });

  app.get<{ Params: { id: string } }>("/api/audiobooks/:id/stream", async (request, reply) => {
    const item = await prisma.mediaItem.findUnique({ where: { id: Number(request.params.id) } });
    if (!item) return reply.code(404).send({ message: "Audiobook not found" });
    try {
      return await streamAudioFile(item.filePath, request.headers.range, reply);
    } catch {
      return reply.code(404).send({ message: "Audio file not found" });
    }
  });

  app.get<{ Params: { id: string } }>("/api/tracks/:id/stream", async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ message: "Invalid track ID" });
    const track = await prisma.track.findUnique({ where: { id } });
    if (!track) return reply.code(404).send({ message: "Track not found" });
    try {
      return await streamAudioFile(track.filePath, request.headers.range, reply);
    } catch {
      return reply.code(404).send({ message: "Audio file not found" });
    }
  });

  // Profiles
  app.get("/api/profiles", async () => prisma.profile.findMany({ orderBy: { createdAt: "asc" } }));

  app.post<{ Body: { name?: string; color?: string } }>("/api/profiles", async (request, reply) => {
    const name = request.body?.name?.trim();
    if (!name) return reply.code(400).send({ message: "A profile name is required" });
    const profile = await prisma.profile.create({ data: { name, color: request.body?.color?.trim() || null } });
    return reply.code(201).send(profile);
  });

  app.delete<{ Params: { id: string } }>("/api/profiles/:id", async (request, reply) => {
    await prisma.profile.delete({ where: { id: Number(request.params.id) } });
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
