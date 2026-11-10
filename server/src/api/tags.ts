import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { fail } from "../http-errors";
import { createTag, mergeTags, renameTag } from "../metadata/tags";

interface TagRoutesOptions {
  prisma: PrismaClient;
  accountExperience: "household" | "demo";
  optionalProfileId: (request: FastifyRequest) => number | null;
  parseIdParam: (raw: string | undefined) => number | null;
}

export function registerTagRoutes(app: FastifyInstance, options: TagRoutesOptions): void {
  const { prisma, accountExperience, optionalProfileId, parseIdParam } = options;

  app.get("/api/tags", async () => {
    const tags = await prisma.tag.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { items: true } } },
    });
    return tags.map((tag) => ({ id: tag.id, name: tag.name, count: tag._count.items }));
  });

  app.post<{ Body: { name: string } }>("/api/tags", {
    schema: {
      body: {
        type: "object",
        properties: { name: { type: "string", minLength: 1, maxLength: 100 } },
        required: ["name"],
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    if (accountExperience === "demo") return fail(reply, 404, "not_found");
    const result = await createTag(prisma, request.body.name, optionalProfileId(request));
    if ("reason" in result) return fail(reply, 409, "tag_name_rejected", { reason: result.reason });
    return reply.code(result.created ? 201 : 200).send(result.tag);
  });

  app.patch<{ Params: { id: string }; Body: { name: string } }>("/api/tags/:id", {
    schema: {
      params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
      body: {
        type: "object",
        properties: { name: { type: "string", minLength: 1, maxLength: 100 } },
        required: ["name"],
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    if (accountExperience === "demo") return fail(reply, 404, "not_found");
    const id = parseIdParam(request.params.id);
    if (id === null) return fail(reply, 400, "invalid_id");
    const result = await renameTag(prisma, id, request.body.name);
    if ("reason" in result) return fail(reply, 409, "tag_name_rejected", { reason: result.reason });
    return result.tag;
  });

  app.delete<{ Params: { id: string } }>("/api/tags/:id", {
    schema: { params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } },
  }, async (request, reply) => {
    if (accountExperience === "demo") return fail(reply, 404, "not_found");
    const id = parseIdParam(request.params.id);
    if (id === null) return fail(reply, 400, "invalid_id");
    const tag = await prisma.tag.findUnique({ where: { id } });
    if (!tag) return fail(reply, 404, "tag_not_found");
    await prisma.tag.delete({ where: { id } });
    return { deleted: true };
  });

  app.post<{ Params: { id: string }; Body: { targetTagId: number } }>("/api/tags/:id/merge", {
    schema: {
      params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
      body: {
        type: "object",
        properties: { targetTagId: { type: "integer", minimum: 1 } },
        required: ["targetTagId"],
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    if (accountExperience === "demo") return fail(reply, 404, "not_found");
    const id = parseIdParam(request.params.id);
    if (id === null) return fail(reply, 400, "invalid_id");
    const { targetTagId } = request.body;
    const result = await mergeTags(prisma, id, targetTagId);
    if ("reason" in result) {
      return fail(reply, result.reason === "not-found" ? 404 : 400, "tag_merge_failed", { reason: result.reason });
    }
    return { moved: result.moved, mergedInto: targetTagId };
  });
}
