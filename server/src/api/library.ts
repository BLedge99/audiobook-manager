import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { PrismaClient } from "@prisma/client";
import { access } from "node:fs/promises";
import path from "node:path";
import { fail } from "../http-errors";
import { addBookToProfile, libraryEntriesFor, removeBookFromProfile } from "../library-membership";
import { trackTitleOverrideField } from "../metadata/chapters";
import { sendConditional } from "./serialization";

export interface LibraryRoutesOptions {
  prisma: PrismaClient;
  accountExperience: "household" | "demo";
  optionalProfileId: (request: FastifyRequest) => number | null;
  requireAccountProfileId: (request: FastifyRequest, reply: FastifyReply) => number | null;
  requireProfileId: (request: FastifyRequest) => number | null;
  parseIdParam: (raw: string | undefined) => number | null;
  canReadMediaItem: (request: FastifyRequest, mediaItemId: number) => Promise<boolean>;
  sendConditional: typeof sendConditional;
}

/** Strip server-side filesystem paths before a payload leaves the server. */
function publicMediaItem<T extends Record<string, unknown>>(item: T): Omit<T, "filePath" | "coverImagePath"> {
  const { filePath: _filePath, coverImagePath: _cover, ...rest } = item;
  return rest as Omit<T, "filePath" | "coverImagePath">;
}

/**
 * Library routes: the profile-scoped book grid, the server library, and the
 * library-root management.
 *
 * Extracted from the app module as the third feature-module cut of the
 * architecture split. Profile scoping and conditional delivery live here so
 * the response-shaping rules travel with the routes that own them.
 */
export function registerLibraryRoutes(app: FastifyInstance, options: LibraryRoutesOptions): void {
  const { prisma, accountExperience, optionalProfileId, requireAccountProfileId, requireProfileId, parseIdParam, canReadMediaItem, sendConditional } = options;

  app.get("/api/audiobooks", async (request, reply) => {
    // Spec 20: the browse UI needs genres, series and custom tags on the list
    // payload -- fetching them per-book would be an N+1 request per shelf.
    const profileId = accountExperience === "demo"
      ? requireAccountProfileId(request, reply)
      : optionalProfileId(request);
    if (accountExperience === "demo" && profileId === null) return;
    // Spec 27: a profile sees its own library, not the whole server's.
    //
    // With no profile there is no caller to scope to, so the whole server
    // library is returned -- the same answer the endpoint gave before spec 27,
    // which keeps tooling and the unscoped API working. The client always
    // sends the header once a profile is chosen.
    const items = await prisma.mediaItem.findMany({
      where: profileId === null ? undefined : libraryEntriesFor(profileId),
      include: {
        tracks: true,
        series: true,
        genres: { include: { genre: true } },
        customTags: { include: { tag: true } },
        contributors: { include: { contributor: true } },
      },
    });
    // One query for the whole library's progress rather than one per book.
    const history = profileId === null
      ? []
      : await prisma.listeningHistory.findMany({
        where: { profileId },
        select: { mediaItemId: true, position: true, completed: true, lastPlayed: true },
      });
    const byItem = new Map(history.map((row) => [row.mediaItemId, row]));
    // Spec 14: the grid needs each book's saved position to render
    // "continue listening" without N+1 requests. Scoped to the caller's profile,
    // so one household member never sees another's position.
    const payload = items.map((item) => {
      const row = byItem.get(item.id);
      return {
        // Spec 11: never expose server filesystem paths to a client.
        ...publicMediaItem({
          ...item,
          tracks: item.tracks.map(({ filePath: _trackPath, ...track }) => track),
        }),
        // Flatten the join rows so the client can filter without walking them.
        genres: item.genres.map((link) => ({
          id: link.genre.id,
          slug: link.genre.slug,
          name: link.genre.name,
          parentId: link.genre.parentId,
          source: link.source,
        })),
        customTags: item.customTags.map((link) => ({
          id: link.tag.id,
          name: link.tag.name,
        })),
        contributors: item.contributors.map((link) => ({
          id: link.contributor.id,
          name: link.contributor.name,
          role: link.contributor.role,
        })),
        progress: row
          ? { position: row.position, completed: row.completed, lastPlayed: row.lastPlayed }
          : null,
      };
    });

    // Spec 15b: a refresh that changed nothing must not resend the library.
    // The tag covers the progress rows too, so it can never be correct for the
    // wrong profile -- and `vary` says so for anything between us and the
    // client that might cache this.
    return sendConditional(request, reply, payload, {
      vary: ["x-profile-id", "x-house-session"],
    });
  });

  /**
   * Spec 27: the whole server library, with each book marked for the caller.
   *
   * This is the other side of `/api/audiobooks`, which returns only the
   * caller's membership. The "Server library" tab reads this: it needs to see
   * every book on the server, including the ones the profile already has, so
   * the household can add what is missing.
   *
   * The `inLibrary` flag is computed from the caller's membership rows, so
   * the tab never has to join two lists itself.
   */
  app.get("/api/server-library", async (request, reply) => {
    const profileId = accountExperience === "demo"
      ? requireAccountProfileId(request, reply)
      : optionalProfileId(request);
    if (accountExperience === "demo" && profileId === null) return;
    const items = await prisma.mediaItem.findMany({
      orderBy: { title: "asc" },
      include: {
        tracks: true,
        series: true,
        genres: { include: { genre: true } },
        customTags: { include: { tag: true } },
        contributors: { include: { contributor: true } },
      },
    });
    const held = profileId === null
      ? new Set<number>()
      : new Set(
          (await prisma.profileLibraryEntry.findMany({
            where: { profileId },
            select: { mediaItemId: true },
          })).map((row) => row.mediaItemId),
        );

    const payload = items.map((item) => ({
      ...publicMediaItem({
        ...item,
        tracks: item.tracks.map(({ filePath: _trackPath, ...track }) => track),
      }),
      genres: item.genres.map((link) => ({
        id: link.genre.id,
        slug: link.genre.slug,
        name: link.genre.name,
        parentId: link.genre.parentId,
        source: link.source,
      })),
      customTags: item.customTags.map((link) => ({
        id: link.tag.id,
        name: link.tag.name,
      })),
      contributors: item.contributors.map((link) => ({
        id: link.contributor.id,
        name: link.contributor.name,
        role: link.contributor.role,
      })),
      /** Is this book in the calling profile's library? */
      inLibrary: held.has(item.id),
    }));

    return sendConditional(request, reply, payload, {
      vary: ["x-profile-id", "x-house-session"],
    });
  });

  /**
   * Spec 27: add a book to the calling profile's library.
   *
   * Idempotent: adding a book the profile already has is a 200 with
   * `added: false`, not an error. The client sends an id, never a path.
   */
  app.post<{ Params: { id: string } }>("/api/audiobooks/:id/library", {
    schema: { params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } },
  }, async (request, reply) => {
    const profileId = requireProfileId(request);
    if (profileId === null) return fail(reply, 400, "profile_required");
    const id = parseIdParam(request.params.id);
    if (id === null) return fail(reply, 400, "invalid_id");
    const item = await prisma.mediaItem.findUnique({ where: { id }, select: { id: true } });
    if (!item) return fail(reply, 404, "audiobook_not_found");
    const added = await addBookToProfile(prisma, profileId, id);
    return { added, inLibrary: true };
  });

  /**
   * Spec 27: remove a book from the calling profile's library.
   *
   * The book stays on the server. The server library is a property of the
   * filesystem, so a book removed from every profile simply appears in nobody's
   * shelf -- it is not deleted from disk.
   */
  app.delete<{ Params: { id: string } }>("/api/audiobooks/:id/library", {
    schema: { params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } },
  }, async (request, reply) => {
    const profileId = requireProfileId(request);
    if (profileId === null) return fail(reply, 400, "profile_required");
    const id = parseIdParam(request.params.id);
    if (id === null) return fail(reply, 400, "invalid_id");
    const removed = await removeBookFromProfile(prisma, profileId, id);
    return { removed, inLibrary: false };
  });

  app.get<{ Params: { id: string } }>("/api/audiobooks/:id", async (request, reply) => {
    // Number("abc") is NaN, which Prisma turns into a 500. Validate like the
    // other id routes so a bad id is a 400/404, not a server error.
    const id = parseIdParam((request.params as { id: string }).id);
    if (id === null) return fail(reply, 400, "invalid_id");
    const item = await prisma.mediaItem.findUnique({
      where: { id },
      include: { tracks: true, contributors: { include: { contributor: true } } },
    });
    if (!item) return fail(reply, 404, "audiobook_not_found");
    if (accountExperience === "demo" && !(await canReadMediaItem(request, item.id))) return fail(reply, 404, "audiobook_not_found");
    // Spec 11: strip filePath / coverImagePath (and track paths) from the payload.
    return publicMediaItem({
      ...item,
      tracks: item.tracks.map(({ filePath: _trackPath, ...track }) => track),
    });
  });

  app.get("/api/library-roots", async (request, reply) => {
    if (accountExperience === "demo") return fail(reply, 404, "not_found");
    // Conditional for the same reason as the library, and separately: scan
    // state changes during a scan even when no book does, so sharing one tag
    // with `/api/audiobooks` would hide a running scan.
    const roots = await prisma.libraryRoot.findMany({ include: { scanState: true }, orderBy: { createdAt: "asc" } });
    return sendConditional(request, reply, roots);
  });

  app.post<{ Body: { path?: string; label?: string } }>("/api/library-roots", async (request, reply) => {
    if (accountExperience === "demo") return fail(reply, 404, "not_found");
    const rootPath = request.body.path?.trim();
    if (!rootPath) return fail(reply, 400, "library_path_required");
    try {
      await access(rootPath);
    } catch {
      return fail(reply, 400, "library_path_inaccessible");
    }
    const root = await prisma.libraryRoot.upsert({
      where: { path: path.resolve(rootPath) },
      create: { path: path.resolve(rootPath), label: request.body.label?.trim() || path.basename(rootPath) },
      update: { label: request.body.label?.trim() || path.basename(rootPath) },
    });
    return reply.code(201).send(root);
  });

  app.delete<{ Params: { id: string } }>("/api/library-roots/:id", async (request, reply) => {
    if (accountExperience === "demo") return fail(reply, 404, "not_found");
    const id = parseIdParam(request.params.id);
    if (id === null) return fail(reply, 400, "invalid_id");
    await prisma.libraryRoot.delete({ where: { id } });
    return reply.code(204).send();
  });

  app.put<{ Params: { id: string; trackNumber: string }; Body: { title?: unknown } }>(
    "/api/audiobooks/:id/tracks/:trackNumber/title",
    {
      schema: {
        params: {
          type: "object",
          properties: { id: { type: "integer" }, trackNumber: { type: "integer", minimum: 1 } },
          required: ["id", "trackNumber"],
        },
        body: {
          type: "object",
          properties: { title: { type: ["string", "null"], maxLength: 500 } },
        },
      },
    },
    async (request, reply) => {
      const id = parseIdParam(request.params.id);
      if (id === null) return fail(reply, 400, "invalid_id");
      const trackNumber = Number(request.params.trackNumber);
      if (!Number.isInteger(trackNumber) || trackNumber < 1) {
        return fail(reply, 400, "invalid_track_number");
      }

      const item = await prisma.mediaItem.findUnique({ where: { id }, select: { id: true } });
      if (!item) return fail(reply, 404, "audiobook_not_found");

      const track = await prisma.track.findFirst({ where: { mediaItemId: id, trackNumber } });
      if (!track) return fail(reply, 404, "track_not_found");

      const field = trackTitleOverrideField(trackNumber);
      const raw = request.body?.title;
      const title = typeof raw === "string" ? raw.trim() : null;
      if (title === null || title.length === 0) {
        await prisma.fieldOverride.deleteMany({ where: { mediaItemId: id, field } });
        return { ok: true, trackNumber, title: null, overridden: false };
      }

      await prisma.fieldOverride.upsert({
        where: { mediaItemId_field: { mediaItemId: id, field } },
        create: { mediaItemId: id, field, value: title },
        update: { value: title },
      });
      await prisma.track.update({ where: { id: track.id }, data: { title } });
      return { ok: true, trackNumber, title, overridden: true };
    },
  );

  app.put<{ Params: { id: string } }>("/api/audiobooks/:id/favourite", {
    schema: { params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } },
  }, async (request, reply) => {
    const profileId = requireProfileId(request);
    if (profileId === null) return fail(reply, 400, "profile_required");
    const id = parseIdParam(request.params.id);
    if (id === null) return fail(reply, 400, "invalid_id");
    const item = await prisma.mediaItem.findUnique({ where: { id }, select: { id: true } });
    if (!item) return fail(reply, 404, "audiobook_not_found");
    const existing = await prisma.favourite.findUnique({
      where: { profileId_mediaItemId: { profileId, mediaItemId: id } },
    });
    if (existing) return { favourited: true, alreadyExisted: true };
    await prisma.favourite.create({ data: { profileId, mediaItemId: id } });
    return { favourited: true, alreadyExisted: false };
  });

  app.delete<{ Params: { id: string } }>("/api/audiobooks/:id/favourite", {
    schema: { params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } },
  }, async (request, reply) => {
    const profileId = requireProfileId(request);
    if (profileId === null) return fail(reply, 400, "profile_required");
    const id = parseIdParam(request.params.id);
    if (id === null) return fail(reply, 400, "invalid_id");
    const { count } = await prisma.favourite.deleteMany({ where: { profileId, mediaItemId: id } });
    return { favourited: false, removed: count };
  });
}
