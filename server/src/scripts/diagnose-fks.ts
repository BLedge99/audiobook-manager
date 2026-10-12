/**
 * Report the foreign keys SQLite actually has, and which ones would block a
 * `MediaItem` delete. The scanner's reconciliation deletes books it no longer
 * sees, and spec 16-19 added several child tables referencing MediaItem.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRawUnsafe<{ type: string; name: string; tbl_name: string; sql: string }[]>(
    "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  );
  console.log("=== tables ===");
  console.log(rows.map((row) => row.name).join(", "));

  const fks = await prisma.$queryRawUnsafe<
    { id: number; seq: number; table: string; from: string; to: string; on_update: string; on_delete: string }[]
  >("PRAGMA foreign_key_list('MediaItem')");
  console.log("\n=== FKs declared ON MediaItem (these block deleting a MediaItem row) ===");
  for (const fk of fks) {
    console.log(`  ${fk.table}.${fk.from} -> ${fk.to}  ON DELETE ${fk.on_delete}`);
  }

  const children = [
    "Favourite",
    "MediaItemTag",
    "FieldOverride",
    "EnrichmentItem",
    "WishlistItem",
    "Track",
    "MetadataCandidate",
    "ListeningHistory",
    "PlaySession",
    "ContributorMediaItem",
  ];
  console.log("\n=== child row counts referencing MediaItem ===");
  for (const table of children) {
    try {
      const count = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*) AS n FROM "${table}"`);
      console.log(`  ${table}: ${count[0].n}`);
    } catch {
      console.log(`  ${table}: (missing)`);
    }
  }

  // The blocker is a child table whose FK to MediaItem does NOT cascade.
  console.log("\n=== every FK pointing at MediaItem ===");
  for (const table of children) {
    let fks: { table: string; from: string; on_delete: string }[];
    try {
      fks = await prisma.$queryRawUnsafe<{ table: string; from: string; on_delete: string }[]>(
        `PRAGMA foreign_key_list('${table}')`,
      );
    } catch {
      continue;
    }
    for (const fk of fks) {
      if (fk.table !== "MediaItem") continue;
      const cascades = fk.on_delete.toUpperCase().includes("CASCADE") || fk.on_delete.toUpperCase().includes("SET NULL");
      console.log(
        `  ${table}.${fk.from} -> MediaItem ON DELETE ${fk.on_delete}${cascades ? "" : "   <-- BLOCKS DELETE"}`,
      );
    }
  }

  // Is FK enforcement even on? SQLite defaults it off per connection.
  const pragma = await prisma.$queryRawUnsafe<{ foreign_keys: number }[]>("PRAGMA foreign_keys");
  console.log(`\nPRAGMA foreign_keys = ${pragma[0]?.foreign_keys} (0 means SQLite would not enforce, 1 enforces)`);

  await prisma.$disconnect();
}

void main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});