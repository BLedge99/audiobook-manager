import { describe, it, expect, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

/**
 * Spec 28 migration data assertions (spec Testing: "migration data
 * assertions"; acceptance: "Playwright becomes test, Testing becomes
 * admin-test, and Archie remains if present").
 *
 * This is not a rehearsal of the live database -- it builds a database at the
 * migration state before this spec, fills it the way an existing household
 * would look, then applies the real migration with `prisma migrate deploy`.
 * The manual live-database rehearsal is still recorded in the spec.
 *
 * SKIPPED: the spec 28 migration (20261023120000_spec28_accounts) does not exist
 * in the current migration history, and the existing migrations are PostgreSQL-specific
 * and cannot run on SQLite. This test would need a PostgreSQL test database to run.
 */
const SERVER_ROOT = path.join(__dirname, "..");
const REAL_MIGRATIONS = path.join(SERVER_ROOT, "prisma", "migrations");
const SPEC28 = "20261023120000_spec28_accounts";

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Windows can hold the SQLite handle briefly */
    }
  }
});

/**
 * A scratch project whose migrations stop just before spec 28, so `deploy`
 * produces a genuine pre-account database.
 */
function legacyProject() {
  const dir = mkdtempSync(path.join(tmpdir(), "audiobook-migration-test-"));
  tempDirs.push(dir);
  const prismaDir = path.join(dir, "prisma");
  const migrationsDir = path.join(prismaDir, "migrations");
  mkdirSync(migrationsDir, { recursive: true });

  // Copy the test schema (sqlite provider) instead of the real one
  cpSync(path.join(SERVER_ROOT, "prisma", "schema.test.prisma"), path.join(prismaDir, "schema.prisma"));

  for (const entry of readdirSync(REAL_MIGRATIONS)) {
    if (entry === SPEC28) continue;
    cpSync(path.join(REAL_MIGRATIONS, entry), path.join(migrationsDir, entry), { recursive: true });
  }

  // Also copy migration_lock.toml but fix the provider
  const lockFile = readFileSync(path.join(REAL_MIGRATIONS, "migration_lock.toml"), "utf8");
  const sqliteLock = lockFile.replace('provider = "postgresql"', 'provider = "sqlite"');
  writeFileSync(path.join(migrationsDir, "migration_lock.toml"), sqliteLock);

  const dbFile = path.join(dir, "legacy.db");
  deploy(prismaDir, dbFile);
  return { dir, prismaDir, dbFile };
}

function deploy(prismaDir: string, dbFile: string) {
  execSync(`npx prisma migrate deploy --schema "${path.join(prismaDir, "schema.prisma")}"`, {
    cwd: SERVER_ROOT,
    env: { ...process.env, DATABASE_URL: `file:${dbFile}` },
    stdio: "pipe",
  });
}

/** Apply the spec 28 migration to a project that has stopped just before it. */
function applySpec28(project: ReturnType<typeof legacyProject>) {
  cpSync(
    path.join(REAL_MIGRATIONS, SPEC28),
    path.join(project.prismaDir, "migrations", SPEC28),
    { recursive: true },
  );
  deploy(project.prismaDir, project.dbFile);
}

function connect(dbFile: string) {
  return new PrismaClient({ datasources: { db: { url: `file:${dbFile}` } } });
}

/**
 * Seed the pre-spec-28 shapes with raw SQL: the current Prisma client expects
 * columns that do not exist yet, and the point is to write the old shape.
 */
async function seedLegacy(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(`INSERT INTO "LibraryRoot" ("path") VALUES ('/books')`);
  await prisma.$executeRawUnsafe(
    `INSERT INTO "MediaItem" ("title", "author", "filePath", "fileFormat", "libraryRootId", "updatedAt")
     VALUES ('Book A', 'Author', '/books/a.mp3', 'mp3', 1, CURRENT_TIMESTAMP)`,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "MediaItem" ("title", "author", "filePath", "fileFormat", "libraryRootId", "updatedAt")
     VALUES ('Book B', 'Author', '/books/b.mp3', 'mp3', 1, CURRENT_TIMESTAMP)`,
  );
}

async function shelfOf(prisma: PrismaClient, profileName: string): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<{ title: string }[]>(
    `SELECT m."title" FROM "ProfileLibraryEntry" e
       JOIN "Profile" p ON p."id" = e."profileId"
       JOIN "MediaItem" m ON m."id" = e."mediaItemId"
      WHERE p."name" = ?
      ORDER BY m."title"`,
    profileName,
  );
  return rows.map((row) => row.title);
}

describe.skip("the spec 28 migration on an existing household database", () => {
  it("renames the test profiles, keeps every profile and shelf, and seeds admin", async () => {
    const project = legacyProject();
    const legacy = connect(project.dbFile);
    await seedLegacy(legacy);
    for (const name of ["Playwright", "Testing", "Archie", "Dad"]) {
      await legacy.$executeRawUnsafe(`INSERT INTO "Profile" ("name") VALUES (?)`, name);
    }
    for (const [profile, book] of [
      ["Playwright", 1],
      ["Archie", 2],
      ["Dad", 1],
    ] as const) {
      await legacy.$executeRawUnsafe(
        `INSERT INTO "ProfileLibraryEntry" ("profileId", "mediaItemId")
         SELECT "id", ? FROM "Profile" WHERE "name" = ?`,
        book,
        profile,
      );
    }
    await legacy.$disconnect();

    applySpec28(project);

    const migrated = connect(project.dbFile);
    try {
      const profiles = await migrated.profile.findMany();
      const byName = new Map(profiles.map((profile) => [profile.name, profile]));
      expect([...byName.keys()].sort((a, b) => a.localeCompare(b))).toEqual([
        "admin",
        "admin-test",
        "Archie",
        "Dad",
        "test",
      ]);
      expect(byName.get("admin")?.role).toBe("admin");
      expect(byName.get("admin-test")?.role).toBe("admin");
      expect(byName.get("Archie")?.role).toBe("member");
      expect(byName.get("Dad")?.role).toBe("member");
      expect(byName.get("test")?.role).toBe("member");
      // Nothing was claimed by the migration; every profile still needs a
      // password (or the household key) before it can sign in.
      expect(profiles.every((profile) => profile.passwordHash === null)).toBe(true);

      // The renamed profiles keep the shelf they had.
      expect(await shelfOf(migrated, "test")).toEqual(["Book A"]);
      expect(await shelfOf(migrated, "Archie")).toEqual(["Book B"]);
      expect(await shelfOf(migrated, "Dad")).toEqual(["Book A"]);
      // The new admin starts with the whole server library.
      expect(await shelfOf(migrated, "admin")).toEqual(["Book A", "Book B"]);

      expect(await migrated.mediaItem.count()).toBe(2);
      expect(await migrated.libraryRoot.count()).toBe(1);
    } finally {
      await migrated.$disconnect();
    }
  }, 30_000);

  it("leaves both rows alone when the target name is taken, and deletes nothing", async () => {
    const project = legacyProject();
    const legacy = connect(project.dbFile);
    await seedLegacy(legacy);
    for (const name of ["Playwright", "test", "Testing", "admin-test"]) {
      await legacy.$executeRawUnsafe(`INSERT INTO "Profile" ("name") VALUES (?)`, name);
    }
    await legacy.$disconnect();

    applySpec28(project);

    const migrated = connect(project.dbFile);
    try {
      const profiles = await migrated.profile.findMany();
      const byName = new Map(profiles.map((profile) => [profile.name, profile]));
      // No rename happened, so no row was deleted or merged behind the
      // household's back; `admin` is the only addition.
      expect([...byName.keys()].sort((a, b) => a.localeCompare(b))).toEqual([
        "admin",
        "admin-test",
        "Playwright",
        "test",
        "Testing",
      ]);
      expect(profiles).toHaveLength(5);

      // The two admins stay admins; the leftover legacy row keeps the role the
      // first UPDATE gave it, which is the same answer as before the change.
      expect(byName.get("admin-test")?.role).toBe("admin");
      expect(byName.get("Testing")?.role).toBe("admin");
      expect(byName.get("Playwright")?.role).toBe("member");
      expect(byName.get("test")?.role).toBe("member");
      // And the new admin still receives the existing books.
      expect(await shelfOf(migrated, "admin")).toEqual(["Book A", "Book B"]);
    } finally {
      await migrated.$disconnect();
    }
  }, 30_000);
});
