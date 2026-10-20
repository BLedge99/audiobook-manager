/**
 * Live enrichment verification.
 *
 * Scans a real library folder, runs the spec 16 enrichment pass against the
 * live provider APIs, and reports what changed. This is the only way to verify
 * the ADR 008 LibriVox-vs-commercial heuristic and the real provider response
 * shapes -- unit tests use mocked HTTP and cannot catch either.
 *
 * Deliberately reads the library and writes only to a scratch database and the
 * covers directory. It never modifies a media file.
 *
 *   npx tsx src/scripts/verify-enrichment.ts [libraryPath]
 */
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const libraryPath = path.resolve(process.argv[2] ?? path.join(__dirname, "..", "..", "..", "test"));

if (!existsSync(libraryPath)) {
  console.error(`[verify] library path does not exist: ${libraryPath}`);
  process.exit(1);
}

const dir = mkdtempSync(path.join(tmpdir(), "audiobook-verify-"));
const dbFile = path.join(dir, "verify.db");
process.env.DATABASE_URL = `file:${dbFile}`;
process.env.COVER_DIR = path.join(dir, "covers");
// Keep the pass brisk; this is a smoke test, not production tuning.
process.env.ENRICHMENT_CONCURRENCY = "3";
process.env.ENRICHMENT_ITEM_DELAY_MS = "150";

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const { createScanManager } = await import("../scanner");
  const { EnrichmentManager } = await import("../metadata/run");
  const { seedGenres, seedGenreMappings } = await import("../metadata/taxonomy-service");

  console.log(`[verify] scratch db: ${dbFile}`);
  // `migrate deploy`, not `db push`: the scratch database is built from the
  // real migrations, so this script cannot pass against a schema the
  // migrations would not produce.
  execSync("npx prisma migrate deploy", {
    cwd: path.join(__dirname, "..", ".."),
    env: { ...process.env },
    stdio: "ignore",
  });

  const prisma = new PrismaClient();
  await seedGenres(prisma);
  await seedGenreMappings(prisma);

  const root = await prisma.libraryRoot.create({ data: { path: libraryPath, label: "verify" } });
  console.log(`[verify] scanning ${libraryPath} ...`);

  const scanner = createScanManager(prisma);
  try {
    await scanner.scanRoot(root.id);
  } catch (error) {
    console.error("[verify] scan failed:", error instanceof Error ? error.message : error);
  }

  const before = await prisma.mediaItem.findMany({
    orderBy: { id: "asc" },
    select: { id: true, title: true, author: true, narrator: true, metadataSource: true },
  });
  console.log(`\n[verify] scanned ${before.length} books. Titles BEFORE enrichment:\n`);
  for (const book of before) {
    console.log(`  #${book.id} ${book.title}  --  ${book.author}`);
  }

  console.log("\n[verify] running live enrichment pass (real network calls)...\n");
  const manager = new EnrichmentManager(prisma);
  const status = await manager.enqueue();

  // Wait for the background pass to finish.
  let last = "";
  for (let i = 0; i < 600; i += 1) {
    const current = await manager.status();
    const line = `${current.status} processed=${current.processed}/${current.queued} applied=${current.applied} review=${current.review} skipped=${current.skipped} failed=${current.failed}`;
    if (line !== last) {
      last = line;
      console.log(`  ${line}`);
    }
    if (current.status === "complete" || current.status === "error") break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const after = await prisma.mediaItem.findMany({
    orderBy: { id: "asc" },
    select: {
      id: true,
      title: true,
      author: true,
      narrator: true,
      metadataSource: true,
      enrichmentStatus: true,
      metadataConfidence: true,
      genres: { include: { genre: true } },
      contributors: { include: { contributor: true } },
    },
  });

  console.log("\n[verify] RESULTS\n");
  let improved = 0;
  for (const book of after) {
    const previous = before.find((b) => b.id === book.id);
    const changed = previous && previous.title !== book.title;
    if (changed) improved += 1;
    console.log(`${changed ? "CHANGED" : "  same "} #${book.id} [${book.metadataSource}/${book.enrichmentStatus}/${(book.metadataConfidence ?? 0).toFixed(2)}]`);
    console.log(`    title:    ${previous?.title ?? "?"}`);
    console.log(`      ->     ${book.title}`);
    console.log(`    author:   ${book.author}`);
    console.log(`    narrator: ${book.narrator ?? "-"}`);
    const genres = book.genres.map((g) => g.genre.slug).join(", ");
    console.log(`    genres:   ${genres || "-"}`);
    const contributors = book.contributors.map((c) => `${c.contributor.name} (${c.contributor.role})`).join(", ");
    console.log(`    people:   ${contributors || "-"}`);
    console.log("");
  }

  const final = await manager.status();
  console.log(`[verify] ${improved}/${after.length} titles changed by enrichment`);
  console.log(`[verify] applied=${final.applied} review=${final.review} skipped=${final.skipped} failed=${final.failed}`);

  const reviewQueue = await prisma.mediaItem.findMany({
    where: { enrichmentStatus: "review" },
    select: { id: true, title: true },
  });
  if (reviewQueue.length > 0) {
    console.log(`\n[verify] ${reviewQueue.length} item(s) need review:`);
    for (const book of reviewQueue) console.log(`  #${book.id} ${book.title}`);
  }

  await prisma.$disconnect();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

void main().catch((error) => {
  console.error("[verify] failed:", error);
  process.exit(1);
});