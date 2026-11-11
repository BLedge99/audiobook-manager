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
import { upsertLibraryRoot, deleteLibraryRoot } from "../library-roots";
import { startScanWithEnrichment } from "../scanning";
import { ADMIN_DB_TABLES, executeReadOnlyQuery, validateReadOnlySql, type AdminDbTable } from "./read-only-sql";
import { fileURLToPath } from "node:url";
import {
  createSignedStorageUploadUrl,
  storageObjectKey,
  type StorageSync,
  type SupabaseStorageConfig,
} from "./supabase-storage";

function routeDocs(app: FastifyInstance): { method: string | string[]; url: string; schema: unknown }[] {
  return ((app as FastifyInstance & { apiDocs?: { method: string | string[]; url: string; schema: unknown }[] }).apiDocs ?? []).map((route) => ({
    ...route,
    schema: route.schema && typeof route.schema === "object" ? route.schema : {},
  }));
}

export async function buildAdminApp(options: {
  prisma: PrismaClient;
  auth: AdminAuth;
  logger?: boolean;
  secureCookie?: boolean;
  startedAt?: number;
  networkMode?: string;
  scanner: ScanManager;
  familyApp?: FastifyInstance;
  storage?: SupabaseStorageConfig | null;
  storageSync?: StorageSync;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false, trustProxy: ["127.0.0.1", "::1"] });
  const enrichmentManager = new EnrichmentManager(options.prisma);
  const apiDocs: { method: string | string[]; url: string; schema: unknown }[] = [];
  app.decorate("apiDocs", apiDocs);
  app.addHook("onRoute", (route) => {
    if (route.url.startsWith("/api/")) apiDocs.push({ method: route.method, url: route.url, schema: route.schema ?? {} });
  });
  await app.register(cookie);
  await registerAdminAuth(app, options.auth, options.secureCookie ?? false);
  app.get("/api/health", async () => ({ ok: true, adminConfigured: await options.auth.isConfigured() }));
  app.get("/api/admin/config", async () => ({ adminConfigured: await options.auth.isConfigured() }));
  app.get("/api/admin/status", { preHandler: requireAdminSession(options.auth) }, async () => {
    const [roots, bookCount, profileCount, newestEntry, newestScan, enrichment] = await Promise.all([
      options.prisma.libraryRoot.findMany({ include: { scanState: true }, orderBy: { id: "asc" } }),
      options.prisma.mediaItem.count(),
      options.prisma.profile.count(),
      options.prisma.profileLibraryEntry.findFirst({ orderBy: { id: "desc" }, select: { createdAt: true } }),
      options.prisma.scanState.findFirst({ orderBy: { lastScanAt: "desc" }, select: { lastScanAt: true } }),
      enrichmentManager.status(),
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
      storage: {
        configured: Boolean(options.storage && options.storageSync),
        sync: options.storageSync?.state() ?? {
          status: "idle", filesDownloaded: 0, lastSyncAt: null, message: null,
        },
      },
      freshness: { newestProfileLibraryEntryAt: newestEntry?.createdAt ?? null },
    };
  });
  app.post<{ Body: { bookName: string; relativePath: string } }>("/api/admin/storage/upload-url", {
    preHandler: requireAdminSession(options.auth),
    schema: {
      body: {
        type: "object",
        properties: {
          bookName: { type: "string", minLength: 1, maxLength: 120 },
          relativePath: { type: "string", minLength: 1, maxLength: 900 },
        },
        required: ["bookName", "relativePath"],
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    if (!options.storage) return fail(reply, 503, "storage_not_configured");
    if (!storageObjectKey(request.body.bookName, request.body.relativePath)) {
      return fail(reply, 400, "storage_object_path_invalid");
    }
    try {
      const url = await createSignedStorageUploadUrl(options.storage, request.body.bookName, request.body.relativePath);
      return reply.send({ url });
    } catch (error) {
      request.log.warn({ error }, "admin storage upload URL creation failed");
      return fail(reply, 502, "storage_upload_unavailable");
    }
  });
  app.get("/api/admin/storage/status", { preHandler: requireAdminSession(options.auth) }, async () => ({
    configured: Boolean(options.storage && options.storageSync),
    sync: options.storageSync?.state() ?? {
      status: "idle", filesDownloaded: 0, lastSyncAt: null, message: null,
    },
  }));
  app.post("/api/admin/storage/sync", { preHandler: requireAdminSession(options.auth) }, async (_request, reply) => {
    if (!options.storageSync) return fail(reply, 503, "storage_not_configured");
    if (!options.storageSync.start()) return fail(reply, 409, "storage_sync_in_progress");
    return reply.code(202).send({ status: "started" });
  });
  app.get("/api/admin/library-roots", { preHandler: requireAdminSession(options.auth) }, async () => {
    return options.prisma.libraryRoot.findMany({ include: { scanState: true }, orderBy: { createdAt: "asc" } });
  });
  app.post<{ Body: { path?: string; label?: string } }>("/api/admin/library-roots", {
    preHandler: requireAdminSession(options.auth),
    schema: { body: { type: "object", properties: { path: { type: "string", maxLength: 4096 }, label: { type: "string", maxLength: 200 } }, additionalProperties: false } },
  }, async (request, reply) => {
    const result = await upsertLibraryRoot(options.prisma, request.body);
    if (!result.ok) {
      return fail(reply, 400, result.reason === "path-required" ? "library_path_required" : "library_path_inaccessible");
    }
    return reply.code(201).send(result.root);
  });
  app.delete<{ Params: { id: string } }>("/api/admin/library-roots/:id", {
    preHandler: requireAdminSession(options.auth),
    schema: { params: { type: "object", properties: { id: { type: "string", pattern: "^[1-9][0-9]*$", maxLength: 10 } }, required: ["id"], additionalProperties: false } },
  }, async (request, reply) => {
    const result = await deleteLibraryRoot(options.prisma, request.params.id);
    if (!result.ok) {
      return fail(reply, result.reason === "invalid-id" ? 400 : 404, result.reason === "invalid-id" ? "invalid_id" : "not_found");
    }
    return reply.code(204).send();
  });
  app.post<{ Body: { rootId?: number } }>("/api/admin/scan", {
    preHandler: requireAdminSession(options.auth),
    schema: { body: { type: "object", properties: { rootId: { type: "integer", minimum: 1 } }, additionalProperties: false } },
  }, async (request, reply) => {
    const result = await startScanWithEnrichment(
      { prisma: options.prisma, scanner: options.scanner, enrichment: enrichmentManager, logger: app.log },
      { rootId: request.body.rootId },
    );
    if (!result.started) return fail(reply, 400, "library_root_required");
    return reply.code(202).send({ status: "started", rootIds: result.rootIds });
  });
  app.get("/api/admin/scan/status", { preHandler: requireAdminSession(options.auth) }, async () => {
    const roots = await options.prisma.libraryRoot.findMany({ include: { scanState: true }, orderBy: { id: "asc" } });
    return roots.map((root) => ({
      rootId: root.id,
      label: root.label,
      status: options.scanner.getProgress(root.id) || root.scanState || { status: "idle", filesFound: 0 },
    }));
  });
  app.get("/api/admin/db/tables", { preHandler: requireAdminSession(options.auth) }, async () => {
    const provider = (process.env.DATABASE_URL ?? "").startsWith("file:") ? "sqlite" : "postgresql";
    const sqliteUrl = process.env.DATABASE_URL ?? "";
    const driver = provider === "sqlite" ? await import("better-sqlite3") : null;
    const db = driver ? new driver.default(fileURLToPath(sqliteUrl.split("?")[0]), { readonly: true, fileMustExist: true }) : null;
    let tables: { name: AdminDbTable; count: number }[];
    try {
      tables = await Promise.all(ADMIN_DB_TABLES.map(async (table) => ({
        name: table,
        count: db ? Number((db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as { count: number }).count) : Number((await options.prisma.$queryRawUnsafe<[{ count: bigint | number }]>(`SELECT COUNT(*) AS count FROM "${table}"`))[0].count),
      })));
    } finally { db?.close(); }
    return { tables };
  });
  app.get<{ Params: { table: string }; Querystring: { page?: number; pageSize?: number } }>("/api/admin/db/tables/:table", {
    preHandler: requireAdminSession(options.auth),
    schema: {
      params: { type: "object", properties: { table: { type: "string", enum: [...ADMIN_DB_TABLES] } }, required: ["table"], additionalProperties: false },
      querystring: { type: "object", properties: { page: { type: "integer", minimum: 1, maximum: 100000 }, pageSize: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false },
    },
  }, async (request) => {
    const table = request.params.table as AdminDbTable;
    const page = request.query.page ?? 1;
    const pageSize = request.query.pageSize ?? 25;
    const provider = (process.env.DATABASE_URL ?? "").startsWith("file:") ? "sqlite" : "postgresql";
    const sqliteUrl = process.env.DATABASE_URL ?? "";
    const driver = provider === "sqlite" ? await import("better-sqlite3") : null;
    const db = driver ? new driver.default(fileURLToPath(sqliteUrl.split("?")[0]), { readonly: true, fileMustExist: true }) : null;
    let columns: unknown[];
    let rows: unknown[];
    try {
      if (db) {
        columns = db.pragma(`table_info("${table}")`) as unknown[];
        rows = db.prepare(`SELECT * FROM "${table}" ORDER BY 1 LIMIT ? OFFSET ?`).all(pageSize, (page - 1) * pageSize);
      } else {
        columns = await options.prisma.$queryRawUnsafe("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position", table);
        rows = await options.prisma.$queryRawUnsafe(`SELECT * FROM "${table}" ORDER BY 1 LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`);
      }
    } catch (error) {
      db?.close();
      throw error;
    }
    const total = db ? Number((db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as { count: number } | undefined)?.count ?? 0) : Number((await options.prisma.$queryRawUnsafe<[{ count: bigint | number }]>(`SELECT COUNT(*) AS count FROM "${table}"`))[0].count);
    db?.close();
    return { table, columns, rows, page, pageSize, total };
  });
  app.get("/api/admin/api-docs", { preHandler: requireAdminSession(options.auth) }, async () => ({
    admin: routeDocs(app),
    family: options.familyApp ? routeDocs(options.familyApp) : [],
  }));
  app.post<{ Body: { sql?: string } }>("/api/admin/db/query", {
    preHandler: requireAdminSession(options.auth),
    schema: { body: { type: "object", properties: { sql: { type: "string", maxLength: 10_000 } }, required: ["sql"], additionalProperties: false } },
  }, async (request, reply) => {
    const sql = request.body.sql ?? "";
    const invalid = validateReadOnlySql(sql);
    if (invalid) return reply.code(400).send({ code: "admin_query_rejected", reason: invalid });
    try {
      const provider = (process.env.DATABASE_URL ?? "").startsWith("file:") ? "sqlite" : "postgresql";
      const rows = await executeReadOnlyQuery(provider, sql);
      return { rows: rows.slice(0, 500), truncated: rows.length > 500, rowCount: Math.min(rows.length, 500) };
    } catch (error) {
      request.log.warn({ error }, "admin read-only query failed");
      return fail(reply, 400, "admin_query_failed");
    }
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
