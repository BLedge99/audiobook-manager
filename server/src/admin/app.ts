import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import type { PrismaClient } from "@prisma/client";
import { AdminAuth, registerAdminAuth, requireAdminSession } from "./auth";
import { fail } from "../http-errors";
import path from "node:path";
import { existsSync } from "node:fs";
import { access } from "node:fs/promises";
import { EnrichmentManager } from "../metadata/run";
import type { ScanManager } from "../scanner";

export async function buildAdminApp(options: {
  prisma: PrismaClient;
  auth: AdminAuth;
  logger?: boolean;
  secureCookie?: boolean;
  startedAt?: number;
  networkMode?: string;
  scanner: ScanManager;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  await app.register(cookie);
  await registerAdminAuth(app, options.auth, options.secureCookie ?? false);
  app.get("/api/health", async () => ({ ok: true, adminConfigured: await options.auth.isConfigured() }));
  app.get("/api/admin/status", { preHandler: requireAdminSession(options.auth) }, async () => {
    const [roots, bookCount, profileCount, newestEntry, newestScan, enrichment] = await Promise.all([
      options.prisma.libraryRoot.findMany({ include: { scanState: true }, orderBy: { id: "asc" } }),
      options.prisma.mediaItem.count(),
      options.prisma.profile.count(),
      options.prisma.profileLibraryEntry.findFirst({ orderBy: { id: "desc" }, select: { createdAt: true } }),
      options.prisma.scanState.findFirst({ orderBy: { lastScanAt: "desc" }, select: { lastScanAt: true } }),
      new EnrichmentManager(options.prisma).status(),
    ]);
    const rootStatus = await Promise.all(roots.map(async (root) => {
      let accessible = false;
      try { await access(root.path); accessible = true; } catch { /* report unavailable without failing dashboard */ }
      const itemCount = await options.prisma.mediaItem.count({ where: { libraryRootId: root.id } });
      return {
        id: root.id, label: root.label, path: root.path, accessible, itemCount,
        scan: root.scanState ? {
          status: root.scanState.status, filesFound: root.scanState.filesFound,
          lastScanAt: root.scanState.lastScanAt, message: root.scanState.message,
        } : null,
      };
    }));
    const databaseUrl = process.env.DATABASE_URL ?? "";
    const databaseType = databaseUrl.startsWith("file:") ? "SQLite" : "PostgreSQL";
    const configuredOrigins = [
      "http://localhost:5173", "http://localhost:3000", "https://localhost",
      "http://localhost", "https://books.home.arpa",
      ...(process.env.WEBAUTHN_ORIGIN ? [process.env.WEBAUTHN_ORIGIN] : []),
    ].filter((origin, index, all) => all.indexOf(origin) === index);
    const productionHost = process.env.RENDER === "true" || Boolean(process.env.RENDER_EXTERNAL_HOSTNAME);
    return {
      generatedAt: new Date(),
      mode: options.networkMode ?? process.env.NETWORK_MODE ?? (productionHost ? "production" : "local"),
      remoteAccess: "not-configured",
      server: { nodeVersion: process.version, platform: process.platform, uptimeSeconds: Math.floor(process.uptime()), startedAt: options.startedAt ? new Date(options.startedAt) : null, health: "ok" },
      network: {
        port: Number(process.env.PORT ?? 3000), adminPort: Number(process.env.ADMIN_PORT ?? 3100),
        corsOrigins: configuredOrigins,
        webauthn: { rpId: process.env.WEBAUTHN_RP_ID ?? null, origin: process.env.WEBAUTHN_ORIGIN ?? null },
        mediaTokenSecretConfigured: Boolean(process.env.MEDIA_TOKEN_SECRET && Buffer.byteLength(process.env.MEDIA_TOKEN_SECRET, "utf8") >= 32),
        tunnel: "not detected; remote access is not configured",
      },
      database: { type: databaseType, configured: Boolean(databaseUrl) },
      library: { rootCount: roots.length, bookCount, profileCount, roots: rootStatus },
      scans: { newestScanAt: newestScan?.lastScanAt ?? null },
      enrichment,
      freshness: { newestProfileLibraryEntryAt: newestEntry?.createdAt ?? null },
    };
  });
  app.get("/api/admin/library-roots", { preHandler: requireAdminSession(options.auth) }, async () => {
    return options.prisma.libraryRoot.findMany({ include: { scanState: true }, orderBy: { createdAt: "asc" } });
  });
  app.post<{ Body: { path?: string; label?: string } }>("/api/admin/library-roots", {
    preHandler: requireAdminSession(options.auth),
    schema: { body: { type: "object", properties: { path: { type: "string", maxLength: 4096 }, label: { type: "string", maxLength: 200 } }, additionalProperties: false } },
  }, async (request, reply) => {
    const rootPath = request.body.path?.trim();
    if (!rootPath) return fail(reply, 400, "library_path_required");
    try { await access(rootPath); } catch { return fail(reply, 400, "library_path_inaccessible"); }
    const resolved = path.resolve(rootPath);
    const root = await options.prisma.libraryRoot.upsert({
      where: { path: resolved },
      create: { path: resolved, label: request.body.label?.trim() || path.basename(resolved) },
      update: { label: request.body.label?.trim() || path.basename(resolved) },
    });
    return reply.code(201).send(root);
  });
  app.delete<{ Params: { id: string } }>("/api/admin/library-roots/:id", {
    preHandler: requireAdminSession(options.auth),
    schema: { params: { type: "object", properties: { id: { type: "string", pattern: "^[1-9][0-9]*$", maxLength: 10 } }, required: ["id"], additionalProperties: false } },
  }, async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isSafeInteger(id)) return fail(reply, 400, "invalid_id");
    const exists = await options.prisma.libraryRoot.findUnique({ where: { id }, select: { id: true } });
    if (!exists) return fail(reply, 404, "library_root_required");
    await options.prisma.libraryRoot.delete({ where: { id } });
    return reply.code(204).send();
  });
  app.post<{ Body: { rootId?: number } }>("/api/admin/scan", {
    preHandler: requireAdminSession(options.auth),
    schema: { body: { type: "object", properties: { rootId: { type: "integer", minimum: 1 } }, additionalProperties: false } },
  }, async (request, reply) => {
    const roots = request.body.rootId
      ? await options.prisma.libraryRoot.findMany({ where: { id: request.body.rootId } })
      : await options.prisma.libraryRoot.findMany();
    if (!roots.length) return fail(reply, 400, "library_root_required");
    for (const root of roots) {
      void options.scanner.scanRoot(root.id).then(async () => {
        try { await new EnrichmentManager(options.prisma).enqueue(); }
        catch (error) { app.log.error({ error }, "admin scan enrichment enqueue failed"); }
      }).catch((error) => app.log.error({ error }, "admin scan failed"));
    }
    return reply.code(202).send({ status: "started", rootIds: roots.map(({ id }) => id) });
  });
  app.get("/api/admin/scan/status", { preHandler: requireAdminSession(options.auth) }, async () => {
    const roots = await options.prisma.libraryRoot.findMany({ include: { scanState: true }, orderBy: { id: "asc" } });
    return roots.map((root) => ({
      rootId: root.id,
      label: root.label,
      path: root.path,
      status: options.scanner.getProgress(root.id) || root.scanState || { status: "idle", filesFound: 0 },
    }));
  });
  const clientDist = process.env.ADMIN_CLIENT_DIST ?? (process.env.NODE_ENV === "production"
    ? "/app/client/admin-dist"
    : path.resolve(process.cwd(), "../client/admin-dist"));
  if (existsSync(path.join(clientDist, "index.html"))) {
    const fastifyStatic = (await import("@fastify/static")).default;
    await app.register(fastifyStatic, { root: clientDist, prefix: "/", wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) return reply.code(404).send({ error: "not_found" });
      return reply.sendFile("index.html");
    });
  } else {
    app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: "not_found" }));
  }
  return app;
}
