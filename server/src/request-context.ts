/**
 * Request-scoped wiring shared by the route modules and the listener.
 * Whatever a handler needs from the request that is not platform-level
 * (auth decoration, CORS, the admin proxy) is built here exactly once.
 */
import { fail } from "./http-errors";
import { isDemoMode, type AccountExperience } from "./auth/demo-policy";
import { mediaResourceFromPath, verifyMediaToken } from "./auth/media-token";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";

export function parseIdParam(raw: string | undefined): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id >= 1 ? id : null;
}

/** Test/migration seam: the header only names a profile when nothing else does. */
export function headerProfileId(request: FastifyRequest): number | null {
  const profileId = Number(request.headers["x-profile-id"]);
  return Number.isInteger(profileId) && profileId >= 1 ? profileId : null;
}

/**
 * Optional profile: unlike the progress routes this never 400s, because the
 * library has to render before a profile has been picked. A missing or
 * malformed header simply yields no progress rather than an error.
 *
 * Spec 28: a profile session owns its `profileId`; the header is ignored. The
 * break-glass household session has no profile, so it may still name one
 * during the migration. With auth disabled (development) the header behaves
 * as it always did.
 */
export function makeOptionalProfileId(experience: AccountExperience) {
  return (request: FastifyRequest): number | null => {
    const sessionProfileId = request.auth?.session.profileId ?? null;
    if (sessionProfileId !== null) return sessionProfileId;
    if (isDemoMode(experience)) return null;
    if (request.auth && request.auth.via !== "household") return null;
    return headerProfileId(request);
  };
}

export type OptionalProfileId = ReturnType<typeof makeOptionalProfileId>;

/** In demo mode an account scope must always come from an authenticated profile session. */
export function makeRequireAccountProfileId(experience: AccountExperience) {
  const optionalProfileId = makeOptionalProfileId(experience);
  return (request: FastifyRequest, reply: FastifyReply): number | null => {
    if (isDemoMode(experience)) {
      const profileId = request.auth?.session.profileId;
      if (profileId === null || profileId === undefined) {
        fail(reply, 401, "auth_required");
        return null;
      }
      return profileId;
    }
    return optionalProfileId(request);
  };
}

export function makeRequireProfileId(experience: AccountExperience) {
  const optionalProfileId = makeOptionalProfileId(experience);
  return (request: FastifyRequest): number | null =>
    request.auth?.session.profileId ?? (isDemoMode(experience) ? null : optionalProfileId(request));
}

/**
 * Can this caller read this book? A demo/auth setup scopes reads to the
 * calling profile's own library entries; the household unscoped surface keeps
 * its pre-spec-27 behaviour (whole server library) with auth disabled.
 */
export function createCanReadMediaItem(deps: {
  prisma: PrismaClient;
  authEnabled: boolean;
  accountExperience: AccountExperience;
  mediaTokenSecret: string | undefined;
}) {
  const optionalProfileId = makeOptionalProfileId(deps.accountExperience);
  return async (request: FastifyRequest, mediaItemId: number): Promise<boolean> => {
    const { prisma, authEnabled, mediaTokenSecret } = deps;
    if (!authEnabled) return true;
    let profileId = optionalProfileId(request);
    if (profileId === null) {
      const resource = mediaResourceFromPath(request.url.split("?")[0]);
      const query = request.query as Record<string, unknown> | undefined;
      const claims = resource && verifyMediaToken(mediaTokenSecret, query?.media, resource);
      if (claims) profileId = claims.profileId;
    }
    // A break-glass admin with no selected profile retains the operator access
    // needed for recovery. Profile sessions, including admins, are scoped to
    // the library actually assigned to that profile.
    if (profileId === null) return request.auth?.role === "admin";
    return Boolean(await prisma.profileLibraryEntry.findUnique({
      where: { profileId_mediaItemId: { profileId, mediaItemId } },
      select: { id: true },
    }));
  };
}
