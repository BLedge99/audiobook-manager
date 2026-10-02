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
}

main().catch((err) => {
  console.error("[server] startup failed", err);
  process.exit(1);
});
