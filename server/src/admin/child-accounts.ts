/**
 * Spec 38 / ADR 033 — kids accounts, managed from the admin panel.
 *
 * The family client never creates, re-bands, disables or deletes a child
 * account, and never sets a confirmed age rating; those are operator actions
 * behind the admin-panel credential (ADR 022/033).
 */
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { fail } from "../http-errors";
import { requireAdminSession, type AdminAuth } from "./auth";
import { AGE_BANDS, isAgeBand } from "../age/bands";
import { ageContextFor } from "../age/facts";
import { blockedGenreIds } from "../age/blocklist";
import { visibilityWhere } from "../age/visibility";
import { hashPassword, validatePassword } from "../auth/password";
import { resetProfilePasswordCore } from "../auth/profile-admin";
import { AuthFailure } from "../auth/service";

export interface ChildAccountRouteDeps {
  prisma: PrismaClient;
  auth: AdminAuth;
}

const summary = (child: {
  id: number;
  name: string;
  color: string | null;
  ageBand: string | null;
  followsServerLibrary: boolean;
  disabled: boolean;
  failedLoginCount: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  lastActiveAt: Date | null;
  createdAt: Date;
  passwordHash: string | null;
}, libraryCount: number) => ({
  id: child.id,
  name: child.name,
  color: child.color,
  ageBand: child.ageBand,
  followsServerLibrary: child.followsServerLibrary,
  disabled: child.disabled,
  failedLoginCount: child.failedLoginCount,
  lockedUntil: child.lockedUntil,
  lastLoginAt: child.lastLoginAt,
  lastActiveAt: child.lastActiveAt,
  createdAt: child.createdAt,
  hasPassword: child.passwordHash !== null,
  libraryCount,
});

export function registerChildAccountRoutes(
  app: FastifyInstance,
  deps: ChildAccountRouteDeps,
): void {
  const { prisma, auth } = deps;
  const guard = { preHandler: requireAdminSession(auth) };

  app.get("/api/admin/kids-accounts", guard, async () => {
    const kids = await prisma.profile.findMany({
      where: { role: "child" },
      orderBy: { id: "asc" },
    });
    const counts = await Promise.all(
      kids.map((child) => prisma.profileLibraryEntry.count({ where: { profileId: child.id } })),
    );
    return kids.map((child, index) => summary(child, counts[index]));
  });

  app.post<{ Body: { name?: string; ageBand?: string; password?: string } }>(
    "/api/admin/kids-accounts",
    {
      ...guard,
      schema: {
        body: {
          type: "object",
          properties: {
            name: { type: "string", minLength: 1, maxLength: 80 },
            ageBand: { type: "string", enum: [...AGE_BANDS] },
            password: { type: "string", minLength: 1, maxLength: 128 },
          },
          required: ["name", "ageBand", "password"],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const name = (request.body.name ?? "").trim();
      if (!name) return fail(reply, 400, "profile_name_required");
      if (!isAgeBand(request.body.ageBand)) return fail(reply, 400, "request_invalid", { reason: "age-band" });
      const passwordFailure = validatePassword(request.body.password!, name);
      if (passwordFailure) return fail(reply, 400, passwordFailure.code, passwordFailure.params);
      const existing = await prisma.profile.findUnique({ where: { name }, select: { id: true } });
      if (existing) return fail(reply, 409, "profile_name_taken");
      const now = new Date();
      const child = await prisma.profile.create({
        data: {
          name,
          role: "child",
          ageBand: request.body.ageBand,
          passwordHash: await hashPassword(request.body.password!),
          passwordUpdatedAt: now,
          // A kids account never follows the server library; the one-tap
          // fill-shelf is the explicit exception (spec 38).
          followsServerLibrary: false,
        },
      });
      return reply.code(201).send(summary(child, 0));
    },
  );

  app.patch<{
    Params: { id: string };
    Body: { name?: string; ageBand?: string; disabled?: boolean };
  }>(
    "/api/admin/kids-accounts/:id",
    {
      ...guard,
      schema: {
        params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"], additionalProperties: false },
        body: {
          type: "object",
          properties: {
            name: { type: "string", minLength: 1, maxLength: 80 },
            ageBand: { type: "string", enum: [...AGE_BANDS] },
            disabled: { type: "boolean" },
          },
          additionalProperties: false,
          minProperties: 1,
        },
      },
    },
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!Number.isInteger(id) || id < 1) return fail(reply, 400, "invalid_id");
      const child = await prisma.profile.findUnique({ where: { id } });
      if (!child || child.role !== "child") return fail(reply, 404, "not_found");

      const data: { name?: string; ageBand?: string; disabled?: boolean } = {};
      if (request.body.name !== undefined) {
        const name = request.body.name.trim();
        if (!name) return fail(reply, 400, "profile_name_required");
        const existing = await prisma.profile.findUnique({ where: { name }, select: { id: true } });
        if (existing && existing.id !== child.id) return fail(reply, 409, "profile_name_taken");
        data.name = name;
      }
      if (request.body.ageBand !== undefined) {
        if (!isAgeBand(request.body.ageBand)) return fail(reply, 400, "request_invalid", { reason: "age-band" });
        data.ageBand = request.body.ageBand;
      }
      if (request.body.disabled !== undefined) data.disabled = request.body.disabled;

      const updated = await prisma.profile.update({ where: { id }, data });
      const libraryCount = await prisma.profileLibraryEntry.count({ where: { profileId: id } });
      return summary(updated, libraryCount);
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/admin/kids-accounts/:id",
    {
      ...guard,
      schema: { params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"], additionalProperties: false } },
    },
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!Number.isInteger(id) || id < 1) return fail(reply, 400, "invalid_id");
      const child = await prisma.profile.findUnique({ where: { id }, select: { id: true, role: true } });
      if (!child || child.role !== "child") return fail(reply, 404, "not_found");
      await prisma.profile.delete({ where: { id } });
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { id: string }; Body: { newPassword: string } }>(
    "/api/admin/kids-accounts/:id/reset-password",
    {
      ...guard,
      schema: {
        params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"], additionalProperties: false },
        body: {
          type: "object",
          properties: { newPassword: { type: "string", minLength: 1, maxLength: 128 } },
          required: ["newPassword"],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!Number.isInteger(id) || id < 1) return fail(reply, 400, "invalid_id");
      const child = await prisma.profile.findUnique({ where: { id }, select: { id: true, role: true } });
      if (!child || child.role !== "child") return fail(reply, 404, "not_found");
      try {
        await resetProfilePasswordCore(prisma, id, request.body.newPassword);
        return { ok: true };
      } catch (error) {
        if (error instanceof AuthFailure) return fail(reply, error.status, error.code, error.params);
        throw error;
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/admin/kids-accounts/:id/fill-shelf",
    {
      ...guard,
      schema: { params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"], additionalProperties: false } },
    },
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!Number.isInteger(id) || id < 1) return fail(reply, 400, "invalid_id");
      const child = await prisma.profile.findUnique({ where: { id }, select: { id: true, role: true, ageBand: true } });
      if (!child || child.role !== "child") return fail(reply, 404, "not_found");

      // Everything the child may see under the age gate, not just unshelved.
      // Compute the delta explicitly: SQLite has no skipDuplicates.
      const ctx = await ageContextFor(prisma, "child", id);
      const blocked = await blockedGenreIds(prisma);
      const scope = visibilityWhere(ctx, blocked)!;
      const books = await prisma.mediaItem.findMany({ where: scope as never, select: { id: true } });
      const added = await prisma.$transaction(async (tx) => {
        const existing = await tx.profileLibraryEntry.findMany({
          where: { profileId: id },
          select: { mediaItemId: true },
        });
        const have = new Set(existing.map((row) => row.mediaItemId));
        const toAdd = books
          .filter((book) => !have.has(book.id))
          .map((book) => ({ profileId: id, mediaItemId: book.id }));
        if (toAdd.length > 0) await tx.profileLibraryEntry.createMany({ data: toAdd });
        return toAdd.length;
      });
      return { added, totalAgeAppropriate: books.length };
    },
  );
}
