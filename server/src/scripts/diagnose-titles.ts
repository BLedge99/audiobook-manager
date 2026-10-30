/**
 * Diagnostic: why are book titles not being corrected?
 *
 * Reads the live database and reports, per book, what the scanner *would* be
 * allowed to write given the current override state. Read-only.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const roots = await prisma.libraryRoot.findMany({ include: { scanState: true } });
  console.log("=== library roots ===");
  for (const root of roots) {
    console.log(`  ${root.id} ${root.path}`);
    console.log(
      `    scan: status=${root.scanState?.status ?? "never"} files=${root.scanState?.filesFound ?? 0} last=${root.scanState?.lastScanAt?.toISOString() ?? "never"} msg=${root.scanState?.message ?? "-"}`,
    );
  }

  const items = await prisma.mediaItem.findMany({
    orderBy: { id: "asc" },
    include: { overrides: true, series: true },
  });
  const overrides = await prisma.fieldOverride.findMany();

  console.log(`\n=== media items (${items.length}) ===`);
  for (const item of items) {
    const fileName = item.filePath.split(/[\\/]/).pop();
    const looksLikeIdentifier = /_(librivox|\d{3,})$/i.test(item.filePath.split(/[\\/]/).slice(-2)[0] ?? "");
    console.log(`#${item.id}`);
    console.log(`  title:        ${item.title}`);
    console.log(`  author:       ${item.author}`);
    console.log(`  folder:       ${item.filePath.split(/[\\/]/).slice(-2)[0]}`);
    console.log(`  file:         ${fileName}`);
    console.log(`  source:       ${item.metadataSource}  status=${item.enrichmentStatus}  conf=${item.metadataConfidence ?? "-"}`);
    console.log(`  overrides:    ${item.overrides.length ? item.overrides.map((o) => o.field).join(", ") : "(none)"}`);
    // The scanner freezes the whole book when it sees the legacy sentinel and
    // no per-field overrides exist. That is the ADR 009 compatibility path.
    const legacyLock =
      (item.metadataSource === "user" || item.metadataSource === "manual") && item.overrides.length === 0;
    if (legacyLock) {
      console.log(`  ** LEGACY LOCK: scanner will NOT rewrite the title for this book`);
    }
    if (looksLikeIdentifier) console.log(`  ** folder name looks like an archive identifier (never scanned since the fix)`);
  }

  console.log(`\n=== field overrides (${overrides.length}) ===`);
  for (const row of overrides) {
    const item = items.find((entry) => entry.id === row.mediaItemId);
    console.log(`  book#${row.mediaItemId} (${item?.title ?? "gone"}) . ${row.field} = ${JSON.stringify(row.value)}`);
  }

  const runs = await prisma.enrichmentRun.findMany({ orderBy: { id: "desc" }, take: 3 });
  console.log(`\n=== recent enrichment runs ===`);
  for (const run of runs) {
    console.log(
      `  #${run.id} ${run.status} processed=${run.processed}/${run.queued} applied=${run.applied} review=${run.review} skipped=${run.skipped} started=${run.startedAt?.toISOString() ?? "-"}`,
    );
  }

  const candidates = await prisma.metadataCandidate.count();
  console.log(`\nstored candidates: ${candidates}`);

  await prisma.$disconnect();
}

void main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});