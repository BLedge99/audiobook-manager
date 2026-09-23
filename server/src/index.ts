import Fastify from "fastify";
import cors from "@fastify/cors";
import { PrismaClient } from "@prisma/client";
import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import { createScanManager } from "./scanner";

console.log("[server] module loading");

const prisma = new PrismaClient();
console.log("[server] PrismaClient created");

const app = Fastify({ logger: true });
const scanner = createScanManager(prisma);
console.log("[server] Fastify app created");

function serializeBigInts<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, nestedValue) => (
    typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue
  ))) as T;
}

app.addHook("preSerialization", async (_request, _reply, payload) => serializeBigInts(payload));

app.setErrorHandler((error, request, reply) => {
  console.error(`[server] request failed: ${request.method} ${request.url}`, error);
  reply.send(error);
});

process.on("uncaughtException", (error) => {
  console.error("[server] uncaughtException", error);
});

process.on("unhandledRejection", (error) => {
  console.error("[server] unhandledRejection", error);
});

// Register CORS for development (client runs on port 5173)
app.register(cors, {
  origin: ["http://localhost:5173", "http://localhost:3000"],
});

// Health check endpoint
app.get("/api/health", async () => {
  console.log("[server] health request received");
  return { status: "ok" };
});

// Get all audiobooks
app.get("/api/audiobooks", async () => {
  const items = await prisma.mediaItem.findMany({
    include: { tracks: true, contributors: true },
  });
  return items;
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

app.get<{ Params: { rootId?: string } }>("/api/scan/status", async () => {
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
    return streamAudioFile(item.filePath, request.headers.range, reply);
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

console.log("[server] all routes registered");

const PORT = parseInt(process.env.PORT || "3000", 10);

console.log(`[server] attempting to listen on 0.0.0.0:${PORT}`);
app.listen({ port: PORT, host: "0.0.0.0" })
  .then(() => console.log(`[server] listening on 0.0.0.0:${PORT}`))
  .catch((err) => {
    console.error("[server] listen failed", err);
    process.exit(1);
  });

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
