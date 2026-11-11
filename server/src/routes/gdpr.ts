/**
 * The self-service rights surface (GDPR Art. 15/16/17 + Art. 20 portability):
 * export everything held about the caller, correct it, erase it, or remove a
 * single record. Admin break-glass deletion lives with the profiles routes.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { fail } from "../http-errors";
import { eraseProfilePersonalData, exportProfilePersonalData } from "../gdpr/personal-data";

export interface GdprRouteDeps {
  prisma: PrismaClient;
  parseIdParam: (raw: string | undefined) => number | null;
  requireProfileId: (request: FastifyRequest) => number | null;
}

export async function registerGdprRoutes(
  app: FastifyInstance,
  deps: GdprRouteDeps,
): Promise<void> {
  const { prisma, parseIdParam, requireProfileId } = deps;

  // Right of access & data portability (GDPR Art. 15, 20): export all personal
  // data for the authenticated profile. Session-only secrets (token hashes,
  // password hashes) are never included.
  app.get("/api/me/export", async (request, reply) => {
    const profileId = requireProfileId(request);
    if (profileId === null) return fail(reply, 400, "profile_required");

    const exported = await exportProfilePersonalData(prisma, profileId);
    if (!exported) return fail(reply, 404, "not_found");
    return reply.send(exported);
  });

  // Right to rectification (GDPR Art. 16): the authenticated profile may
  // correct their own display name and colour.
  app.patch<{ Body: { name?: string; color?: string } }>("/api/me", {
    schema: {
      body: {
        type: "object",
        properties: {
          name: { type: "string" },
          color: { type: "string" },
        },
      },
    },
  }, async (request, reply) => {
    const profileId = requireProfileId(request);
    if (profileId === null) return fail(reply, 400, "profile_required");
    const { name, color } = request.body ?? {};
    if (name !== undefined && (!name || !name.trim())) return fail(reply, 400, "profile_name_required");
    const existing = name !== undefined ? await prisma.profile.findUnique({ where: { name: name.trim() } }) : null;
    if (existing && existing.id !== profileId) return fail(reply, 409, "profile_name_taken");
    const profile = await prisma.profile.update({
      where: { id: profileId },
      data: { name: name !== undefined ? name.trim() : undefined, color: color !== undefined ? (color.trim() || null) : undefined },
      select: { id: true, name: true, color: true },
    });
    return reply.send(profile);
  });

  // Right to erasure (GDPR Art. 17): self-service account deletion. The
  // authenticated profile deletes their own account and every related row.
  // Admin break-glass deletion remains at DELETE /api/profiles/:id.
  app.delete("/api/me", async (request, reply) => {
    const profileId = requireProfileId(request);
    if (profileId === null) return fail(reply, 400, "profile_required");

    await eraseProfilePersonalData(prisma, profileId);
    return reply.code(204).send();
  });

  // Right to erasure (GDPR Art. 17): delete a single listening-history entry.
  app.delete<{ Params: { historyId: string } }>("/api/me/listening-history/:historyId", async (request, reply) => {
    const profileId = requireProfileId(request);
    if (profileId === null) return fail(reply, 400, "profile_required");
    const historyId = parseIdParam(request.params.historyId);
    if (historyId === null) return fail(reply, 400, "invalid_id");
    const entry = await prisma.listeningHistory.findUnique({ where: { id: historyId } });
    if (!entry || entry.profileId !== profileId) return fail(reply, 404, "not_found");
    await prisma.listeningHistory.delete({ where: { id: historyId } });
    return reply.code(204).send();
  });

  // Right to erasure (GDPR Art. 17): remove a single favourite.
  app.delete<{ Params: { mediaItemId: string } }>("/api/me/favourites/:mediaItemId", async (request, reply) => {
    const profileId = requireProfileId(request);
    if (profileId === null) return fail(reply, 400, "profile_required");
    const mediaItemId = parseIdParam(request.params.mediaItemId);
    if (mediaItemId === null) return fail(reply, 400, "invalid_id");
    const { count } = await prisma.favourite.deleteMany({ where: { profileId, mediaItemId } });
    if (count === 0) return fail(reply, 404, "not_found");
    return reply.code(204).send();
  });
}
