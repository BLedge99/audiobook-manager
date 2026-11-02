import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AdminAuth, ADMIN_SESSION_TTL_MS, registerAdminAuth } from "./auth";
import { buildAdminApp } from "./app";
import { buildApp } from "../app";
import { createTestDatabase } from "../test-support/database";
import { createScanManager } from "../scanner";

const db = createTestDatabase("audiobook-admin-auth-");
let prisma: PrismaClient;
let app: FastifyInstance;
let auth: AdminAuth;
let adminApp: FastifyInstance;

beforeAll(async () => {
  prisma = new PrismaClient();
  await prisma.$connect();
  auth = new AdminAuth(prisma);
  await auth.seed("dedicated-admin-password");
  adminApp = await buildAdminApp({ prisma, auth, scanner: createScanManager(prisma) });
  app = Fastify();
  await app.register(cookie);
  await registerAdminAuth(app, auth, false);
});
afterAll(async () => {
  await app.close();
  await adminApp.close();
  await prisma.$disconnect();
  db.cleanup();
});

describe("admin panel authentication", () => {
  it("stores only a password hash and uses a separate HttpOnly cookie", async () => {
    const credential = await prisma.adminCredential.findUnique({ where: { id: 1 } });
    expect(credential?.passwordHash).not.toBe("dedicated-admin-password");
    const response = await app.inject({ method: "POST", url: "/api/admin/login", payload: { password: "dedicated-admin-password" } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toContain("admin_panel_session=");
    expect(response.headers["set-cookie"]).toContain("HttpOnly");
    const row = await prisma.adminSession.findFirst();
    expect(row?.tokenHash).not.toContain(response.headers["set-cookie"]?.toString().split(";")[0].split("=")[1]);
  });

  it("rejects wrong passwords without disclosing the cause and rate-limits attempts", async () => {
    for (let index = 0; index < 10; index++) {
      const response = await app.inject({ method: "POST", url: "/api/admin/login", remoteAddress: "192.0.2.10", payload: { password: "wrong-password" } });
      expect(response.statusCode).toBe(401);
    }
    const limited = await app.inject({ method: "POST", url: "/api/admin/login", remoteAddress: "192.0.2.10", payload: { password: "dedicated-admin-password" } });
    expect(limited.statusCode).toBe(401);
    expect(limited.json().code).toBe("auth_required");
  });

  it("validates sessions, expires them, and revokes on logout", async () => {
    const token = await auth.login("dedicated-admin-password", "192.0.2.11");
    expect(token).toBeTruthy();
    expect(await auth.validate(token!)).toBe(true);
    const session = await prisma.adminSession.findFirstOrThrow({ where: { tokenHash: (await import("../auth/session")).hashSessionToken(token!) } });
    await prisma.adminSession.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() - ADMIN_SESSION_TTL_MS) } });
    expect(await auth.validate(token!)).toBe(false);
    const nextToken = await auth.login("dedicated-admin-password", "192.0.2.12");
    await auth.logout(nextToken!);
    expect(await auth.validate(nextToken!)).toBe(false);
  });

  it("returns only not-found on the main app's admin paths and locks when unconfigured", async () => {
    const mainApp = await buildApp({ prisma, logger: false, appPassword: "household-password", scanner: createScanManager(prisma) });
    const response = await mainApp.inject({ method: "POST", url: "/api/admin/login", payload: { password: "dedicated-admin-password" } });
    expect(response.statusCode).toBe(404);
    expect(response.headers["set-cookie"]).toBeUndefined();
    await mainApp.close();

    await prisma.adminCredential.deleteMany();
    const unconfiguredAuth = new AdminAuth(prisma);
    const lockedApp = await buildAdminApp({ prisma, auth: unconfiguredAuth, scanner: createScanManager(prisma) });
    const health = await lockedApp.inject({ url: "/api/health" });
    expect(health.json().adminConfigured).toBe(false);
    const login = await lockedApp.inject({ method: "POST", url: "/api/admin/login", payload: { password: "anything" } });
    expect(login.statusCode).toBe(503);
    expect(login.json().code).toBe("admin_not_configured");
    await lockedApp.close();
    await auth.seed("dedicated-admin-password");
  });

  it("reports status only to a valid admin session and avoids returning secret values", async () => {
    const unauthorized = await adminApp.inject({ url: "/api/admin/status" });
    expect(unauthorized.statusCode).toBe(401);
    const token = await auth.login("dedicated-admin-password", "192.0.2.13");
    const session = await adminApp.inject({ url: "/api/admin/status", cookies: { admin_panel_session: token! } });
    expect(session.statusCode).toBe(200);
    const payload = session.json();
    expect(payload.database.type).toBe("SQLite");
    expect(payload.server.nodeVersion).toBe(process.version);
    expect(payload.library.roots).toEqual(expect.any(Array));
    expect(JSON.stringify(payload)).not.toContain("dedicated-admin-password");
  });

  it("adds and removes library roots and requires admin auth for every mutation", async () => {
    const denied = await adminApp.inject({ method: "POST", url: "/api/admin/library-roots", payload: { path: process.cwd() } });
    expect(denied.statusCode).toBe(401);
    const token = await auth.login("dedicated-admin-password", "192.0.2.14");
    const added = await adminApp.inject({
      method: "POST", url: "/api/admin/library-roots", cookies: { admin_panel_session: token! },
      payload: { path: process.cwd(), label: "Test root" },
    });
    expect(added.statusCode).toBe(201);
    const rootId = added.json().id as number;
    const roots = await adminApp.inject({ url: "/api/admin/library-roots", cookies: { admin_panel_session: token! } });
    expect(roots.json().some((root: { id: number }) => root.id === rootId)).toBe(true);
    const removed = await adminApp.inject({ method: "DELETE", url: `/api/admin/library-roots/${rootId}`, cookies: { admin_panel_session: token! } });
    expect(removed.statusCode).toBe(204);
  });

  it("starts scans through the shared scanner and reports their state", async () => {
    const token = await auth.login("dedicated-admin-password", "192.0.2.15");
    const root = await prisma.libraryRoot.create({ data: { path: process.cwd(), label: "Scan test" } });
    const response = await adminApp.inject({ method: "POST", url: "/api/admin/scan", cookies: { admin_panel_session: token! }, payload: { rootId: root.id } });
    expect(response.statusCode).toBe(202);
    expect(response.json().rootIds).toContain(root.id);
    const status = await adminApp.inject({ url: "/api/admin/scan/status", cookies: { admin_panel_session: token! } });
    expect(status.statusCode).toBe(200);
    expect(status.json().some((entry: { rootId: number }) => entry.rootId === root.id)).toBe(true);
    await prisma.libraryRoot.delete({ where: { id: root.id } });
  });
});
