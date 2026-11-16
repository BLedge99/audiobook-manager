import "dotenv/config";
import { buildApp } from "./app";
import { seedDefaultProfiles } from "./seed";
import { buildAdminApp } from "./admin/app";
import { AdminAuth } from "./admin/auth";
import { PrismaClient } from "@prisma/client";
import { createScanManager } from "./scanner";
import { oauthConfigFromEnv } from "./auth/oauth";
import { createSupabaseLibrarySync, supabaseStorageConfigFromEnv } from "./admin/supabase-storage";

const PORT = parseInt(process.env.PORT || "3000", 10);
const ADMIN_PORT = parseInt(process.env.ADMIN_PORT || "3100", 10);

async function main() {
  const prisma = new PrismaClient();
  // Spec 43 phase 1.2: WAL persists per database file and gives single-writer
  // SQLite real reader/writer concurrency while a scan holds a transaction.
  // Postgres is unaffected. Best effort — the server comes up either way.
  // (Prisma's SQLite engine has no per-connection busy_timeout knob; short
  // transactions are the primary control, WAL is the file-level win.)
  if ((process.env.DATABASE_URL ?? "").startsWith("file:")) {
    try {
      const { default: Database } = await import("better-sqlite3");
      const db = new Database((process.env.DATABASE_URL ?? "").replace(/^file:/, "").split("?")[0]);
      db.pragma("journal_mode = WAL");
      db.pragma("busy_timeout = 5000");
      db.close();
    } catch (err) {
      console.warn("[server] could not set SQLite pragmas (continuing):", err);
    }
  }
  const scanner = createScanManager(prisma);
  const storage = supabaseStorageConfigFromEnv();
  const storageSync = storage ? createSupabaseLibrarySync({
    config: storage,
    prisma,
    scanner,
    onError: (error) => console.error("[storage] library sync failed", error),
  }) : undefined;
  const app = await buildApp({
    logger: true, prisma, scanner,
    // Spec 37 / ADR 029: the admin proxy belongs to the hosted single-port
    // deployment only. The household compose leaves ADMIN_PROXY unset and
    // reaches the panel on ADMIN_PORT instead.
    ...(process.env.ADMIN_PROXY === "true" ? { adminProxyTarget: `http://127.0.0.1:${ADMIN_PORT}` } : {}),
  });
  const adminAuth = new AdminAuth(prisma);
  if (process.env.ADMIN_PANEL_PASSWORD) {
    await adminAuth.seed(process.env.ADMIN_PANEL_PASSWORD);
    console.log("[server] admin-panel credential seeded");
  }
  const adminApp = await buildAdminApp({
    prisma, auth: adminAuth, scanner, familyApp: app, logger: true, startedAt: Date.now(),
    storage, storageSync,
    secureCookie: process.env.COOKIE_SECURE === "true",
  });
  // First launch: create the default household profiles so progress
  // is profile-scoped from the very first play. No-op once seeded.
  try {
    if ((await prisma.profile.count()) === 0) {
      const created = await seedDefaultProfiles(prisma);
      console.log(`[server] seeded default profiles: ${created.join(", ")}`);
    }
  } catch (err) {
    console.error("[server] profile seeding skipped:", err);
  }

  // Spec 28: expired and revoked auth rows are cleared at startup as well as
  // on login. Best effort by design -- `validate` already rejects them, so a
  // failure here must not stop the server from serving.
  try {
    const { AuthService } = await import("./auth/service");
    await new AuthService({ prisma, oauth: oauthConfigFromEnv() }).cleanupExpired();
    console.log("[server] cleaned up expired auth rows");
  } catch (err) {
    console.error("[server] auth cleanup skipped:", err);
  }

  await app.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`[server] listening on 0.0.0.0:${PORT}`);
  // The admin panel is a loopback-only operator surface by default. Binding it to
  // all interfaces puts it on the LAN (or, in Docker, on the bridge network) with
  // nothing but the admin password in front — set ADMIN_HOST=0.0.0.0 deliberately
  // if you actually want that, and front it with TLS.
  const adminHost = process.env.ADMIN_HOST ?? "127.0.0.1";
  await adminApp.listen({ port: ADMIN_PORT, host: adminHost });
  console.log(`[admin] listening on ${adminHost}:${ADMIN_PORT}`);
  if (storageSync?.start()) console.log("[storage] startup library sync started");

  // Spec 17: seed the genre taxonomy and provider mappings. Idempotent, and
  // must run before any enrichment pass so provider genres have somewhere to
  // map to.
  try {
    const { seedGenreMappings, seedGenres } = await import("./metadata/taxonomy-service");
    const genres = await seedGenres(prisma);
    const mappings = await seedGenreMappings(prisma);
    if (genres > 0 || mappings > 0) {
      console.log(`[server] seeded taxonomy: ${genres} genres, ${mappings} provider mappings`);
    }
  } catch (err) {
    console.error("[server] taxonomy seed failed:", err);
  }

  // Spec 38: the default blocklist, once per installation, only after the
  // taxonomy exists (so the slugs resolve). Best effort; logged, never fatal.
  try {
    const { seedDefaultBlocklist } = await import("./age/default-blocklist");
    const blocked = await seedDefaultBlocklist(prisma);
    if (blocked > 0) {
      console.log(`[server] seeded the default kids-account blocklist: ${blocked} genres`);
    }
  } catch (err) {
    console.error("[server] default blocklist seed failed:", err);
  }

  // Spec 16: pick up an enrichment run that a previous process left mid-flight
  // rather than leaving the library permanently half-enriched.
  try {
    const { EnrichmentManager } = await import("./metadata/run");
    await new EnrichmentManager(prisma).resumeIncomplete();
    console.log("[server] checked for a resumable enrichment run");
  } catch (err) {
    console.error("[server] enrichment resume skipped:", err);
  }
}

main().catch((err) => {
  console.error("[server] startup failed", err);
  process.exit(1);
});
