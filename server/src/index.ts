import Fastify from "fastify";
import cors from "@fastify/cors";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const app = Fastify({ logger: true });

// Register CORS for development (client runs on port 5173)
app.register(cors, {
  origin: ["http://localhost:5173", "http://localhost:3000"],
});

// Health check endpoint
app.get("/api/health", async () => {
  return { status: "ok" };
});

// Get all audiobooks
app.get("/api/audiobooks", async () => {
  const items = await prisma.mediaItem.findMany({
    include: { tracks: true, contributors: true },
  });
  return items;
});

// Trigger a library scan (stub for now)
app.post("/api/scan", async () => {
  app.log.info("Library scan triggered");
  // TODO: Implement actual scanning logic
  return { status: "started", message: "Scan in progress" };
});

const PORT = parseInt(process.env.PORT || "3000", 10);

app.listen({ port: PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
