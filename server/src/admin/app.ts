import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import type { PrismaClient } from "@prisma/client";
import { AdminAuth, registerAdminAuth, requireAdminSession } from "./auth";
import { fail } from "../http-errors";
import path from "node:path";
import { existsSync } from "node:fs";

export async function buildAdminApp(options: {
  prisma: PrismaClient;
  auth: AdminAuth;
  logger?: boolean;
  secureCookie?: boolean;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  await app.register(cookie);
  await registerAdminAuth(app, options.auth, options.secureCookie ?? false);
  app.get("/api/health", async () => ({ ok: true, adminConfigured: await options.auth.isConfigured() }));
  app.get("/api/admin/phase", { preHandler: requireAdminSession(options.auth) }, async () => ({ phase: 1 }));
  const clientDist = path.resolve(process.cwd(), "../client/admin-dist");
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
