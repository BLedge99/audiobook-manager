/**
 * One-off repair for the damage the first E2E run caused.
 *
 * An early version of the tag-suite E2E test edited a real library book's
 * title and, because the editor saved every field, also wrote nine FieldOverride
 * rows -- including `publishedYear = "0"` and several empty strings. Those rows
 * are permanent: ADR 009 protects exactly the fields listed there, so the
 * scanner could never correct that book again.
 *
 * Run with:  npx tsx src/scripts/repair-overrides.ts [--apply]
 * Without --apply it reports what it would change.
 */
import { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");

/** Override values that are obviously artefacts of the bug, not user intent. */
function isBogus(field: string, value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") return true; // an empty override blocks the scanner forever
  if (trimmed === "0" && ["publishedYear", "seriesPosition"].includes(field)) return true;
  return false;
}

async function main() {
  const prisma = new PrismaClient();

  const overrides = await prisma.fieldOverride.findMany({ include: { mediaItem: { select: { title: true } } } });
  const bogus = overrides.filter((row) => isBogus(row.field, row.value));
  const real = overrides.filter((row) => !isBogus(row.field, row.value));

  console.log(`override rows: ${overrides.length} total, ${bogus.length} bogus, ${real.length} plausible`);
  for (const row of bogus) {
    console.log(`  BOGUS  book#${row.mediaItemId} (${row.mediaItem.title}) . ${row.field} = ${JSON.stringify(row.value)}`);
  }
  for (const row of real) {
    console.log(`  keep   book#${row.mediaItemId} (${row.mediaItem.title}) . ${row.field} = ${JSON.stringify(row.value)}`);
  }

  // Titles that look like an E2E artefact rather than a real book.
  const items = await prisma.mediaItem.findMany({ select: { id: true, title: true } });
  const e2eTitles = items.filter((item) => /^(Corrected|E2E title)\s/i.test(item.title));
  for (const item of e2eTitles) {
    console.log(`  E2E TITLE book#${item.id} = ${JSON.stringify(item.title)}`);
  }

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to repair.");
    await prisma.$disconnect();
    return;
  }

  if (bogus.length > 0) {
    await prisma.fieldOverride.deleteMany({ where: { id: { in: bogus.map((row) => row.id) } } });
    console.log(`\ndeleted ${bogus.length} bogus override row(s)`);
  }

  // An E2E-created title/author override is a test artefact, not user intent.
  // Clear it and put the title back to the folder name so the next scan can
  // replace it with the real one from the album tag.
  const e2eOverridden = await prisma.fieldOverride.findMany({
    where: { mediaItemId: { in: e2eTitles.map((item) => item.id) } },
  });
  if (e2eOverridden.length > 0) {
    await prisma.fieldOverride.deleteMany({ where: { id: { in: e2eOverridden.map((row) => row.id) } } });
    for (const item of e2eTitles) {
      const folder = item.title; // currently the E2E name; reset below from the file path
      void folder;
      const row = await prisma.mediaItem.findUniqueOrThrow({ where: { id: item.id } });
      const parts = row.filePath.split(/[\\/]/);
      const dirName = parts.length > 1 ? parts[parts.length - 2] : row.title;
      await prisma.mediaItem.update({
        where: { id: item.id },
        data: { title: dirName, metadataSource: "embedded", enrichmentStatus: "pending" },
      });
      console.log(`cleared E2E overrides on book#${item.id}; title reset to "${dirName}" pending a rescan`);
    }
  }

  // Requeue anything the overrides were blocking so a rescan can fix it.
  const affected = [...new Set([...bogus, ...e2eTitles.map((item) => ({ mediaItemId: item.id }))])].map(
    (row) => row.mediaItemId,
  );
  if (affected.length > 0) {
    await prisma.mediaItem.updateMany({
      where: { id: { in: affected } },
      data: { enrichmentStatus: "pending", metadataSource: "embedded" },
    });
    console.log(`requeued ${affected.length} book(s) for enrichment: ${affected.join(", ")}`);
  }

  console.log("\nNow run a scan so the album tag can supply the real title:");
  console.log("  make scan   (or POST /api/scan)");
  await prisma.$disconnect();
}

void main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});