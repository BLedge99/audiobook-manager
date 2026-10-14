import "dotenv/config";
import { buildApp } from "./app";
import { seedDefaultProfiles } from "./seed";

const PORT = parseInt(process.env.PORT || "3000", 10);

async function main() {
  const app = await buildApp({ logger: true });
  // First launch: create the default household profiles so progress
  // is profile-scoped from the very first play. No-op once seeded.
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    if ((await prisma.profile.count()) === 0) {
      const created = await seedDefaultProfiles(prisma);
      console.log(`[server] seeded default profiles: ${created.join(", ")}`);
    }
  } catch (err) {
    console.error("[server] profile seeding skipped:", err);
  } finally {
    await prisma.$disconnect();
  }
  await app.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`[server] listening on 0.0.0.0:${PORT}`);

  // Spec 17: seed the genre taxonomy and provider mappings. Idempotent, and
  // must run before any enrichment pass so provider genres have somewhere to
  // map to.
  try {
    const { PrismaClient } = await import("@prisma/client");
    const { seedGenreMappings, seedGenres } = await import("./metadata/taxonomy-service");
    const seedClient = new PrismaClient();
    const genres = await seedGenres(seedClient);
    const mappings = await seedGenreMappings(seedClient);
    await seedClient.$disconnect();
    if (genres > 0 || mappings > 0) {
      console.log(`[server] seeded taxonomy: ${genres} genres, ${mappings} provider mappings`);
    }
  } catch (err) {
    console.error("[server] taxonomy seed failed:", err);
  }

  // Spec 16: pick up an enrichment run that a previous process left mid-flight
  // rather than leaving the library permanently half-enriched.
  try {
    const { PrismaClient } = await import("@prisma/client");
    const { EnrichmentManager } = await import("./metadata/run");
    const resumeClient = new PrismaClient();
    await new EnrichmentManager(resumeClient).resumeIncomplete();
    await resumeClient.$disconnect();
    console.log("[server] checked for a resumable enrichment run");
  } catch (err) {
    console.error("[server] enrichment resume skipped:", err);
  }
}

main().catch((err) => {
  console.error("[server] startup failed", err);
  process.exit(1);
});
