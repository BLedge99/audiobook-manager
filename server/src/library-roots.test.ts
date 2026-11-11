import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { buildAdminApp } from "./admin/app";
import { AdminAuth } from "./admin/auth";
import { buildApp } from "./app";
import { createScanManager } from "./scanner";
import { createTestDatabase } from "./test-support/database";

const db = createTestDatabase("audiobook-roots-shared-");

let prisma: PrismaClient;
let familyApp: FastifyInstance;
let adminApp: FastifyInstance;
let adminCookie: Record<string, string>;

beforeAll(async () => {
  prisma = new PrismaClient();
  await prisma.$connect();
  const auth = new AdminAuth(prisma);
  await auth.seed("dedicated-admin-password");
  familyApp = await buildApp({ logger: false, prisma });
  adminApp = await buildAdminApp({ prisma, auth, scanner: createScanManager(prisma) });
  const token = await auth.login("dedicated-admin-password", "192.0.2.99");
  adminCookie = { admin_panel_session: token! };
}, 120_000);

afterAll(async () => {
  await familyApp.close();
  await adminApp.close();
  await prisma.$disconnect();
  db.cleanup();
});

describe("the two listeners answer the same codes (spec 37 step 7.8)", () => {
  it("POST with an inaccessible path answers 400 on both", async () => {
    const family = await familyApp.inject({
      method: "POST",
      url: "/api/library-roots",
      payload: { path: "/definitely/not/a/real/path/for/testing" },
    });
    const admin = await adminApp.inject({
      method: "POST",
      url: "/api/admin/library-roots",
      cookies: adminCookie,
      payload: { path: "/definitely/not/a/real/path/for/testing" },
    });
    expect(family.statusCode).toBe(400);
    expect(admin.statusCode).toBe(400);
    expect(family.json()).toEqual(admin.json());
  });

  it("POST with a valid path answers 201 on both", async () => {
    const family = await familyApp.inject({
      method: "POST",
      url: "/api/library-roots",
      payload: { path: process.cwd(), label: "Shared Label" },
    });
    const admin = await adminApp.inject({
      method: "POST",
      url: "/api/admin/library-roots",
      cookies: adminCookie,
      payload: { path: process.cwd(), label: "Shared Label" },
    });
    expect(family.statusCode).toBe(201);
    expect(admin.statusCode).toBe(201);
    expect((family.json() as { path: string }).path).toBe((admin.json() as { path: string }).path);
  });

  it("DELETE of a missing root answers 404 on both", async () => {
    const family = await familyApp.inject({ method: "DELETE", url: "/api/library-roots/999999" });
    const admin = await adminApp.inject({
      method: "DELETE",
      url: "/api/admin/library-roots/999999",
      cookies: adminCookie,
    });
    expect(family.statusCode).toBe(404);
    expect(admin.statusCode).toBe(404);
  });

  it("DELETE of a real root answers 204 on both", async () => {
    const created = await familyApp.inject({
      method: "POST",
      url: "/api/library-roots",
      payload: { path: process.cwd(), label: "Delete Me" },
    });
    const { id } = created.json() as { id: number };
    const family = await familyApp.inject({ method: "DELETE", url: `/api/library-roots/${id}` });
    expect(family.statusCode).toBe(204);

    const createdAgain = await familyApp.inject({
      method: "POST",
      url: "/api/library-roots",
      payload: { path: process.cwd(), label: "Delete Me Admin" },
    });
    const { id: adminId } = createdAgain.json() as { id: number };
    const admin = await adminApp.inject({
      method: "DELETE",
      url: `/api/admin/library-roots/${adminId}`,
      cookies: adminCookie,
    });
    expect(admin.statusCode).toBe(204);
  });

  it("scan with an unknown rootId answers 400 on both", async () => {
    const family = await familyApp.inject({
      method: "POST",
      url: "/api/scan",
      payload: { rootId: 999999 },
    });
    const admin = await adminApp.inject({
      method: "POST",
      url: "/api/admin/scan",
      cookies: adminCookie,
      payload: { rootId: 999999 },
    });
    expect(family.statusCode).toBe(400);
    expect(admin.statusCode).toBe(400);
    expect((family.json() as { code: string }).code).toBe((admin.json() as { code: string }).code);
  });

  it("scan with a real root answers 202 with the same shape on both", async () => {
    const created = await familyApp.inject({
      method: "POST",
      url: "/api/library-roots",
      payload: { path: process.cwd(), label: "Scan Root" },
    });
    const { id: rootId } = created.json() as { id: number };
    const family = await familyApp.inject({
      method: "POST",
      url: "/api/scan",
      payload: { rootId },
    });
    const admin = await adminApp.inject({
      method: "POST",
      url: "/api/admin/scan",
      cookies: adminCookie,
      payload: { rootId },
    });
    expect(family.statusCode).toBe(202);
    expect(admin.statusCode).toBe(202);
    expect(family.json()).toEqual(admin.json());
  });
});
