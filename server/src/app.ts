import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import { createScanManager } from "./scanner";
import type { ScanManager } from "./scanner";
import { addBookToProfile, libraryEntriesFor, removeBookFromProfile } from "./library-membership";
import { LMStudioAdapter } from "./ai/llm";
import { COVER_DIR } from "./enrichment";
import { resolveInsideRoot } from "./safePath";
import { applyCandidate, rowToCandidate, storeCandidates } from "./metadata/apply";
import { coverFilename, fetchCover } from "./metadata/cover";
import { runChain } from "./metadata/chain";
import { trackTitleOverrideField } from "./metadata/chapters";
import { buildQuery, EnrichmentManager } from "./metadata/run";
import { seedGenreMappings, seedGenres, upsertSeries } from "./metadata/taxonomy-service";
import { createTag, mergeTags, renameTag, setBookTags } from "./metadata/tags";
import { RecommendationService, DEFAULT_PAGE_SIZE } from "./metadata/recommend-service";
import { fail } from "./http-errors";
import { AuthService } from "./auth/service";
import { isAdminRoute } from "./auth/policy";
import { PasskeyService, passkeyConfigFromEnv, registerPasskeyRoutes, type PasskeyConfig } from "./auth/passkeys";
import { registerAuthRoutes } from "./auth/routes";
import { SESSION_HEADER, sessionTokenFromRequest } from "./auth/session";
import { issueMediaToken, mediaResourceFromPath, verifyMediaToken } from "./auth/media-token";
import { oauthConfigFromEnv, type OAuthConfig, buildAuthorizeUrl, createPkcePair, oauthProviderById } from "./auth/oauth";

// New feature modules (architecture deepening)
import { errorHandler } from "./api/error-handler";
import { registerAuthGate } from "./api/auth-gate";
import { registerLibraryRoutes } from "./api/library";
import { registerMediaRoutes } from "./api/media";
import { registerProgressRoutes } from "./api/progress";
import { registerScanRoutes } from "./api/scan";
import { registerSerializationHooks, sendConditional } from "./api/serialization";
import { registerTagRoutes } from "./api/tags";
import { registerMetadataRoutes } from "./api/metadata";
import { registerDiscoverRoutes } from "./api/discover";
import { registerPrivacyRoute } from "./api/privacy";
import { clampPosition, normalizeSessionBounds, normalizeSessionSpeed, resolveCompleted } from "./progress-math";

export { SESSION_HEADER };

export function audioContentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".mp3":
      return "audio/mpeg";
    case ".m4a":
    case ".m4b":
    case ".mp4":
      return "audio/mp4";
    case ".flac":
      return "audio/flac";
    case ".ogg":
      return "audio/ogg";
    case ".wav":
      return "audio/wav";
    case ".aac":
      return "audio/aac";
    default:
      return "application/octet-stream";
  }
}

/** Strip server-side filesystem paths before a payload leaves the server. */
function publicMediaItem<T extends Record<string, unknown>>(item: T): Omit<T, "filePath" | "coverImagePath"> {
  const { filePath: _filePath, coverImagePath: _cover, ...rest } = item;
  return rest as Omit<T, "filePath" | "coverImagePath">;
}

/** The largest page a client may ask for, matching the route schemas. */
const MAX_PAGE_SIZE = 20;

export interface BuildAppOptions {
  prisma?: PrismaClient;
  scanner?: ScanManager;
  logger?: boolean;
  appPassword?: string;
  /** Test seam; production leaves the clock alone. */
  now?: () => Date;
  secureCookie?: boolean;
  trustProxy?: boolean | string | string[];
  /** Test seam; production reads `WEBAUTHN_*` from the environment. */
  passkeyConfig?: PasskeyConfig | null;
  /** Test seam; production configures a separate 256-bit media signing key. */
  mediaTokenSecret?: string;
  /** External OAuth providers for production sign-in (spec 32 / ADR 023). */
  oauth?: OAuthConfig;
  /** Loopback target for the isolated admin listener; absent in unit tests. */
  adminProxyTarget?: string;
  /** Production demo account surface; defaults to household for safety. */
  accountExperience?: "household" | "demo";
}

/** Test seam for proving that the family listener has no admin surface. */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const {
    prisma: injectedPrisma,
    scanner: injectedScanner,
    logger = false,
    appPassword,
    now = () => new Date(),
    secureCookie = false,
    trustProxy = false,
    passkeyConfig = null,
    mediaTokenSecret,
    oauth = oauthConfigFromEnv(),
    adminProxyTarget,
    accountExperience = "household",
  } = options;

  const prisma = injectedPrisma ?? new PrismaClient();
  const scanner = injectedScanner ?? createScanManager(prisma);
  const enrichment = new EnrichmentManager(prisma);
  const auth = new AuthService({ prisma, appPassword, oauth, now });
  const passkeyConfigResolved = passkeyConfig ?? passkeyConfigFromEnv();
  const passkeys = new PasskeyService({ prisma, config: passkeyConfigResolved, now });

  const app = Fastify({
    logger,
    trustProxy,
  });

  const apiDocs: { method: string | string[]; url: string; schema: unknown }[] = [];
  app.decorate("apiDocs", apiDocs);
  app.addHook("onRoute", (route) => {
    if (route.url.startsWith("/api/")) {
      apiDocs.push({ method: route.method, url: route.url, schema: route.schema ?? {} });
    }
  });

  registerSerializationHooks(app);

  // Global error handler (ADR 015 error envelope)
  app.setErrorHandler(errorHandler);

  await app.register(cors, {
    origin: (origin, cb) => {
      const allowed = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://localhost",
        "capacitor://localhost",
        "http://localhost",
        "http://127.0.0.1",
        "https://books.home.arpa",
      ];
      if (!origin || allowed.includes(origin)) cb(null, true);
      else cb(new Error("CORS: origin not allowed"), false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", SESSION_HEADER, "X-Profile-Id"],
  });

  await app.register(cookie, {
    secret: mediaTokenSecret ?? "dev-secret-change-in-production",
    hook: "onRequest",
    parseOptions: {
      httpOnly: true,
      secure: secureCookie,
      sameSite: secureCookie ? "none" : "lax",
    },
  });

  // Admin proxy (loopback only, behind auth gate)
  const adminProxyTargetUrl = options.adminProxyTarget ? new URL(options.adminProxyTarget) : null;
  if (adminProxyTargetUrl && !["127.0.0.1", "[::1]", "localhost"].includes(adminProxyTargetUrl.hostname)) {
    throw new Error("adminProxyTarget must point to a loopback address");
  }
  const proxyAdminRequest = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!adminProxyTargetUrl) return fail(reply, 404, "not_found");
    const requestPath = request.url.split("?")[0];
    if (requestPath === "/admin") return reply.redirect("/admin/", 302);
    const upstreamPath = requestPath.startsWith("/admin/")
      ? request.url.slice("/admin".length)
      : request.url;
    const headers: Record<string, string> = {
      "x-forwarded-for": request.ip,
      "x-forwarded-proto": request.protocol,
      "x-forwarded-host": String(request.headers.host ?? ""),
    };
    if (request.headers.cookie) headers.cookie = request.headers.cookie;
    if (request.headers["content-type"]) headers["content-type"] = request.headers["content-type"];
    if (request.headers.accept) headers.accept = request.headers.accept;
    const body = request.body === undefined
      ? undefined
      : typeof request.body === "string" ? request.body : JSON.stringify(request.body);
    try {
      const upstream = await fetch(new URL(upstreamPath, adminProxyTargetUrl), {
        method: request.method,
        headers,
        ...(body === undefined ? {} : { body }),
        redirect: "manual",
      });
      reply.code(upstream.status);
      for (const header of ["content-type", "cache-control", "etag", "last-modified", "location", "vary"]) {
        const value = upstream.headers.get(header);
        if (value) reply.header(header, value);
      }
      const setCookies = upstream.headers.getSetCookie();
      if (setCookies.length) reply.header("set-cookie", setCookies);
      return reply.send(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) {
      request.log.error({ error }, "admin listener proxy failed");
      return fail(reply, 503, "admin_unavailable");
    }
  };
  const adminProxyMethods = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
  app.route({ method: [...adminProxyMethods], url: "/admin", handler: proxyAdminRequest });
  app.route({ method: [...adminProxyMethods], url: "/admin/*", handler: proxyAdminRequest });
  app.route({ method: [...adminProxyMethods], url: "/api/admin", handler: proxyAdminRequest });
  app.route({ method: [...adminProxyMethods], url: "/api/admin/*", handler: proxyAdminRequest });

  // Auth gate: attaches `request.auth` for protected routes
  registerAuthGate(app, {
    auth,
    authEnabled: auth.enabled,
    mediaTokenSecret,
    accountExperience,
    adminProxyTarget: adminProxyTargetUrl,
  });

  // Passkey routes (always registered; returns 503 if not configured)
  await registerPasskeyRoutes(app, passkeys, auth, {
    secureCookie,
    accountExperience,
    accountExperienceResolver: () => accountExperience,
    emailSignUpAllowed: oauth.enabled,
  });

  // Auth routes (login, register, OAuth, etc.)
  await registerAuthRoutes(app, auth, {
    secureCookie,
    accountExperience,
    accountExperienceResolver: () => accountExperience,
    emailSignUpAllowed: accountExperience === "demo",
  });

  // Helper functions for library/media routes
  const headerProfileId = (request: FastifyRequest): number | null => {
    const profileId = Number(request.headers["x-profile-id"]);
    return Number.isInteger(profileId) && profileId >= 1 ? profileId : null;
  };

  const optionalProfileId = (request: FastifyRequest): number | null => {
    if (!auth.enabled) return null;
    const sessionProfileId = request.auth?.session.profileId ?? null;
    if (sessionProfileId !== null) return sessionProfileId;
    if (accountExperience === "demo") return null;
    if (request.auth && request.auth.via !== "household") return null;
    const profileId = headerProfileId(request);
    return profileId;
  };

  /** In demo mode an account scope must always come from an authenticated profile session. */
  const requireAccountProfileId = (request: FastifyRequest, reply: FastifyReply): number | null => {
    if (accountExperience === "demo") {
      const profileId = request.auth?.session.profileId;
      if (profileId === null || profileId === undefined) {
        fail(reply, 401, "auth_required");
        return null;
      }
      return profileId;
    }
    return optionalProfileId(request);
  };

  const requireProfileId = (request: FastifyRequest): number | null => {
    return request.auth?.session.profileId ?? (accountExperience === "demo" ? null : optionalProfileId(request));
  };

  const parseIdParam = (raw: string | undefined): number | null => {
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isInteger(n) && n > 0 ? n : null;
  };

  const canReadMediaItem = async (request: FastifyRequest, mediaItemId: number): Promise<boolean> => {
    if (!auth.enabled) return true;
    let profileId = request.auth?.session.profileId ?? null;
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
    const entry = await prisma.profileLibraryEntry.findUnique({
      where: { profileId_mediaItemId: { profileId, mediaItemId } },
      select: { profileId: true },
    });
    return !!entry;
  };

  // Library routes (browse, search, tags, genres, series, overrides, candidates)
  registerLibraryRoutes(app, {
    prisma,
    accountExperience,
    optionalProfileId,
    requireAccountProfileId,
    requireProfileId,
    parseIdParam,
    canReadMediaItem,
    sendConditional,
  });

  // Media routes (token, stream, cover)
  registerMediaRoutes(app, {
    prisma,
    authEnabled: auth.enabled,
    mediaTokenSecret,
    accountExperience,
    optionalProfileId,
    requireAccountProfileId,
    parseIdParam,
    canReadMediaItem,
    sendConditional,
  });

  // Progress routes (position, sessions, history) - using progress-math
  registerProgressRoutes(app, {
    prisma,
    requireProfileId,
    parseIdParam,
  });

  // Scan routes
  registerScanRoutes(app, {
    prisma,
    scanner,
    enrichment,
    accountExperience,
  });

  // Health check (public)
  app.get("/api/health", async () => ({ status: "ok" }));
  app.get("/api/config", async () => ({
    accountExperience,
    oauthProviders: auth.oauth.enabled
      ? auth.oauth.providers.map((provider) => provider.id)
      : [],
  }));
  registerTagRoutes(app, { prisma, accountExperience, optionalProfileId, parseIdParam });

  // Recommendations service (used by library routes)
  const recommendations = new RecommendationService(prisma);
  registerMetadataRoutes(app, { prisma, enrichment, accountExperience, parseIdParam, canReadMediaItem });
  registerDiscoverRoutes(app, {
    prisma,
    recommendations,
    accountExperience,
    requireProfileId,
    parseIdParam,
  });
  registerPrivacyRoute(app);

  // Remaining routes that don't fit neatly into feature modules yet
  // These are: profiles, GDPR endpoints, AI suggest, and some metadata endpoints

  // Profiles
  const profileSummary = {
    id: true,
    name: true,
    color: true,
    role: true,
    disabled: true,
    createdAt: true,
    followsServerLibrary: true,
  } as const;
  app.get("/api/profiles", async (request, reply) => {
    if (accountExperience === "demo") return fail(reply, 404, "not_found");
    if (auth.enabled && request.auth?.role !== "admin") return fail(reply, 403, "forbidden");
    return prisma.profile.findMany({ orderBy: { createdAt: "asc" }, select: profileSummary });
  });

  app.post<{ Body: { name?: string; color?: string } }>("/api/profiles", async (request, reply) => {
    if (accountExperience === "demo") return fail(reply, 404, "not_found");
    if (auth.enabled && request.auth?.role !== "admin") return fail(reply, 403, "forbidden");
    const name = request.body?.name?.trim();
    if (!name) return fail(reply, 400, "profile_name_required");
    const existing = await prisma.profile.findUnique({ where: { name } });
    if (existing) return fail(reply, 409, "profile_name_taken");
    const profile = await prisma.profile.create({
      data: { name, color: request.body?.color?.trim() || null },
      select: profileSummary,
    });
    return reply.code(201).send(profile);
  });

  app.delete<{ Params: { id: string } }>("/api/profiles/:id", async (request, reply) => {
    if (accountExperience === "demo") return fail(reply, 404, "not_found");
    if (auth.enabled && request.auth?.role !== "admin") return fail(reply, 403, "forbidden");
    await prisma.profile.delete({ where: { id: parseIdParam(request.params.id) ?? -1 } });
    return reply.code(204).send();
  });

  // Right of access & data portability (GDPR Art. 15, 20): export all personal
  // data for the authenticated profile. Session-only secrets (token hashes,
  // password hashes) are never included.
  app.get("/api/me/export", async (request, reply) => {
    const profileId = requireProfileId(request);
    if (profileId === null) return fail(reply, 400, "profile_required");

    const [profile, sessions, listeningHistory, playSessions, favourites, wishlistItems, libraryEntries, deviceCredentials, webAuthnCredentials] = await Promise.all([
      prisma.profile.findUnique({
        where: { id: profileId },
        select: { id: true, name: true, color: true, role: true, createdAt: true, followsServerLibrary: true },
      }),
      prisma.session.findMany({
        where: { profileId },
        select: { id: true, expiresAt: true, userAgent: true, deviceLabel: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.listeningHistory.findMany({
        where: { profileId },
        select: { id: true, mediaItemId: true, position: true, completed: true, lastPlayed: true, playedAt: true },
        orderBy: { playedAt: "desc" },
      }),
      prisma.playSession.findMany({
        where: { profileId },
        select: { id: true, mediaItemId: true, startedAt: true, endedAt: true, fromPosition: true, toPosition: true, speed: true },
        orderBy: { startedAt: "desc" },
      }),
      prisma.favourite.findMany({
        where: { profileId },
        select: { mediaItemId: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.wishlistItem.findMany({
        where: { profileId },
        select: { id: true, title: true, author: true, seedMediaItemId: true, owned: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.profileLibraryEntry.findMany({
        where: { profileId },
        select: { mediaItemId: true },
        orderBy: { mediaItemId: "asc" },
      }),
      prisma.deviceCredential.findMany({
        where: { profileId },
        select: { label: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.webAuthnCredential.findMany({
        where: { profileId },
        select: { credentialId: true, publicKey: true, counter: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    if (!profile) return fail(reply, 404, "not_found");

    return reply.send({
      exportedAt: new Date().toISOString(),
      profile,
      sessions,
      listeningHistory,
      playSessions,
      favourites,
      wishlistItems,
      libraryEntries,
      deviceCredentials,
      webAuthnCredentials,
    });
  });

  // Right to erasure (GDPR Art. 17): self-service account deletion. The
  // authenticated profile deletes their own account and every related row.
  // Admin break-glass deletion remains at DELETE /api/profiles/:id.
  app.delete("/api/me", async (request, reply) => {
    const profileId = requireProfileId(request);
    if (profileId === null) return fail(reply, 400, "profile_required");

    // Cascade: delete every personal-data row owned by this profile.
    await prisma.$transaction([
      prisma.webAuthnChallenge.deleteMany({ where: { profileId } }),
      prisma.webAuthnCredential.deleteMany({ where: { profileId } }),
      prisma.deviceCredential.deleteMany({ where: { profileId } }),
      prisma.session.deleteMany({ where: { profileId } }),
      prisma.listeningHistory.deleteMany({ where: { profileId } }),
      prisma.playSession.deleteMany({ where: { profileId } }),
      prisma.favourite.deleteMany({ where: { profileId } }),
      prisma.wishlistItem.deleteMany({ where: { profileId } }),
      prisma.profileLibraryEntry.deleteMany({ where: { profileId } }),
      prisma.profile.delete({ where: { id: profileId } }),
    ]);

    return reply.code(204).send();
  });

  // Right to rectification (GDPR Art. 16): the authenticated profile may
  // correct their own display name and colour.
  app.patch<{ Body: { name?: string; color?: string } }>("/api/me", async (request, reply) => {
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

  // Spec 18: favourites list and ids
  app.get("/api/favourites", async (request, reply) => {
    const profileId = requireProfileId(request);
    if (profileId === null) return fail(reply, 400, "profile_required");
    const favourites = await prisma.favourite.findMany({
      where: { profileId },
      orderBy: { createdAt: "desc" },
      include: {
        mediaItem: {
          include: {
            series: true,
            genres: { include: { genre: true } },
            customTags: { include: { tag: true } },
            contributors: { include: { contributor: true } },
          },
        },
      },
    });

    return favourites.map((row) => ({
      favouritedAt: row.createdAt,
      book: publicMediaItem({
        ...row.mediaItem,
        tracks: [],
        contributors: row.mediaItem.contributors.map((link) => link.contributor),
      }),
    }));
  });

  /** The current profile's favourites, as a plain id set for list endpoints. */
  app.get("/api/favourites/ids", async (request, reply) => {
    const profileId = requireProfileId(request);
    if (profileId === null) return fail(reply, 400, "profile_required");
    const rows = await prisma.favourite.findMany({ where: { profileId }, select: { mediaItemId: true } });
    return rows.map((row) => row.mediaItemId);
  });

  // AI: optional metadata match assistant (works only if LM Studio is up)
  app.post<{ Params: { id: string } }>("/api/audiobooks/:id/ai-suggest", async (request, reply) => {
    if (accountExperience === "demo") return fail(reply, 404, "not_found");
    const id = parseIdParam(request.params.id);
    if (id === null) return fail(reply, 400, "invalid_id");
    const item = await prisma.mediaItem.findUnique({ where: { id } });
    if (!item) return fail(reply, 404, "audiobook_not_found");
    const adapter = new LMStudioAdapter();
    if (!(await adapter.available())) {
      return { available: false, suggestion: null };
    }
    const candidates = await prisma.metadataCandidate.findMany({ where: { mediaItemId: id }, orderBy: { confidence: "desc" }, take: 5 });
    if (candidates.length === 0) return { available: true, suggestion: null };
    const prompt = `Embedded metadata: title="${item.title}", author="${item.author}", path="${item.filePath}".\nCandidates:\n${candidates.map((c, i) => `${i + 1}. ${c.title} — ${c.author ?? "unknown"} (${c.source})`).join("\n")}\nReply with just the number of the best match, or 0 for none.`;
    const answer = await adapter.chat([{ role: "user", content: prompt }]).catch(() => "");
    const pick = Number(answer.trim().match(/\d+/)?.[0]);
    const suggestion = pick >= 1 && pick <= candidates.length ? candidates[pick - 1] : null;
    return { available: true, suggestion };
  });

  // Serve the built client (production single-origin). In dev the Vite dev
  // server runs separately on :5173, so this only kicks in when client/dist exists.
  const { existsSync } = await import("node:fs");
  const clientDist = process.env.CLIENT_DIST || path.resolve(__dirname, "../../client/dist");
  if (existsSync(clientDist)) {
    const fastifyStatic = (await import("@fastify/static")).default;
    await app.register(fastifyStatic, { root: clientDist, prefix: "/", wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        return fail(reply, 404, "not_found");
      }
      reply.sendFile("index.html");
    });
  }

  return app;
}

async function streamAudioFile(filePath: string, range: string | undefined, reply: import("fastify").FastifyReply) {
  const details = await stat(filePath);
  reply.header("Accept-Ranges", "bytes").type(audioContentType(filePath));
  if (!range) {
    reply.header("Content-Length", details.size);
    return reply.send(createReadStream(filePath));
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) return reply.code(416).header("Content-Range", `bytes */${details.size}`).send();
  const start = match[1] ? Number(match[1]) : Math.max(0, details.size - Number(match[2]));
  const end = match[1] && match[2] ? Number(match[2]) : match[1] ? details.size - 1 : details.size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= details.size || start > end) {
    return reply.code(416).header("Content-Range", `bytes */${details.size}`).send();
  }
  const boundedEnd = Math.min(end, details.size - 1);
  reply.code(206).headers({ "Content-Range": `bytes ${start}-${boundedEnd}/${details.size}`, "Content-Length": boundedEnd - start + 1 });
  return reply.send(createReadStream(filePath, { start, end: boundedEnd }));
}