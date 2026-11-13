import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import compress from "@fastify/compress";
import { cacheControlForPath, isAssetRequest } from "./static-assets";
import { PrismaClient } from "@prisma/client";
import path from "node:path";
import { createScanManager } from "./scanner";
import type { ScanManager } from "./scanner";
import { parseIdParam, makeOptionalProfileId, makeRequireAccountProfileId, makeRequireProfileId, createCanReadMediaItem } from "./request-context";
import { sendConditional } from "./conditional";
import { registerStaticRoutes } from "./routes/static";
import { registerMediaRoutes } from "./routes/media";
import { registerMetadataRoutes } from "./routes/metadata";
import { registerProgressRoutes } from "./routes/progress";
import { registerProfilesRoutes } from "./routes/profiles";
import { registerGdprRoutes } from "./routes/gdpr";
import { registerEnrichmentRoutes } from "./routes/enrichment";
import { registerTaxonomyRoutes } from "./routes/taxonomy";
import { registerDiscoverRoutes } from "./routes/discover";
import { registerBuyContextRoutes } from "./routes/buy-context";
import { registerLibraryRoutes } from "./routes/library";
import { EnrichmentManager } from "./metadata/run";
import { RecommendationService } from "./metadata/recommend-service";
import { fail } from "./http-errors";
import { AuthService } from "./auth/service";
import { isAdminRoute } from "./auth/policy";
import { isDemoMode, isPublicApiPath } from "./auth/demo-policy";
import { PasskeyService, passkeyConfigFromEnv, registerPasskeyRoutes, type PasskeyConfig } from "./auth/passkeys";
import { registerAuthRoutes } from "./auth/routes";
import { SESSION_HEADER, sessionTokenFromRequest } from "./auth/session";
import { mediaResourceFromPath, verifyMediaToken } from "./auth/media-token";
import { oauthConfigFromEnv, type OAuthConfig } from "./auth/oauth";

export { SESSION_HEADER };

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
  /** Test seam; production constructs the real LM Studio adapter in the route. */
  llm?: import("./ai/llm").LLMAdapter;
  /** Loopback target for the isolated admin listener; absent in unit tests. */
  adminProxyTarget?: string;
  /** Production demo account surface; defaults to household for safety. */
  accountExperience?: "household" | "demo";
}

/** Test seam for proving that the family listener has no admin surface. */

function accountExperienceFromEnv(value = process.env.ACCOUNT_EXPERIENCE): "household" | "demo" {
  return value?.trim().toLowerCase() === "demo" ? "demo" : "household";
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const prisma = options.prisma ?? new PrismaClient();
  const configuredProxy = process.env.TRUST_PROXY?.trim();
  const trustProxy = options.trustProxy ?? (
    configuredProxy === "true" ? true
      : configuredProxy ? configuredProxy.split(",").map((value) => value.trim()).filter(Boolean)
        : false
  );
  const app = Fastify({
    // Media URLs carry short-lived bearer tokens in their query string. Keep
    // request URLs and session cookies out of routine request logs.
    logger: options.logger === false ? false : {
      redact: {
        paths: ["req.url", "req.headers.cookie", `req.headers.${SESSION_HEADER}`],
        censor: "[REDACTED]",
      },
    },
    trustProxy,
  });
  // The only compression in the stack when the app is reached directly on
  // :3000 (the Caddy front door adds its own where deployed). Bodies over
  // 1 KB are gzipped when the client accepts it.
  await app.register(compress, { threshold: 1024 });
  const apiDocs: { method: string | string[]; url: string; schema: unknown }[] = [];
  app.decorate("apiDocs", apiDocs);
  app.addHook("onRoute", (route) => {
    if (route.url.startsWith("/api/")) apiDocs.push({ method: route.method, url: route.url, schema: route.schema ?? {} });
  });
  const scanner = options.scanner ?? createScanManager(prisma);
  const enrichment = new EnrichmentManager(prisma);
  const recommendations = new RecommendationService(prisma);
  const appPassword = options.appPassword ?? process.env.APP_PASSWORD;
  const auth = new AuthService({ prisma, appPassword, oauth: options.oauth ?? oauthConfigFromEnv(), now: options.now });
  const accountExperience = options.accountExperience ?? accountExperienceFromEnv();
  const passkeys = new PasskeyService({
    prisma,
    config: options.passkeyConfig ?? passkeyConfigFromEnv(),
    now: options.now,
  });
  const authEnabled = auth.enabled;
  if (isDemoMode(accountExperience) && !authEnabled) {
    throw new Error("APP_PASSWORD must be configured when ACCOUNT_EXPERIENCE=demo");
  }
  const mediaTokenSecret = options.mediaTokenSecret ?? process.env.MEDIA_TOKEN_SECRET ??
    (process.env.NODE_ENV === "production" ? undefined : appPassword);
  if (authEnabled && process.env.NODE_ENV === "production" &&
      (!mediaTokenSecret || Buffer.byteLength(mediaTokenSecret, "utf8") < 32)) {
    throw new Error("MEDIA_TOKEN_SECRET must be set to at least 32 bytes in production");
  }
  const secureCookie = options.secureCookie ?? process.env.COOKIE_SECURE === "true";

  function serializeBigInts<T>(value: T): T {
    return JSON.parse(JSON.stringify(value, (_key, nestedValue) => (
      typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue
    ))) as T;
  }

  app.addHook("preSerialization", async (_request, _reply, payload) => serializeBigInts(payload));

  app.setErrorHandler((error, request, reply) => {
    // The detail is for the server log only. This handler used to echo
    // `error.message` on any 4xx, and that included filesystem paths and
    // Prisma wording (spec 11); the client renders the code instead.
    request.log.error(error);
    const candidateStatusCode =
      typeof error === "object" && error !== null && "statusCode" in error
        ? error.statusCode
        : undefined;
    const statusCode =
      typeof candidateStatusCode === "number" && candidateStatusCode >= 400
        ? candidateStatusCode
        : 500;
    return fail(reply, statusCode, statusCode >= 500 ? "internal_error" : "request_invalid");
  });

  // CORS allow-list.
  //
  // `https://localhost` is the origin Capacitor's WebView serves the app from,
  // and it is not a typo or a wildcard: it is the scheme Capacitor uses for
  // local assets on Android. The phone talking to the LAN server is therefore a
  // genuine cross-origin request, and without this entry every API call is
  // rejected with "No 'Access-Control-Allow-Origin' header is present".
  //
  // It is safe to allow because it identifies the Android app and nothing else.
  // Note this says nothing about who may call the API -- that is auth, handled
  // by the routes and the E2E security suite.
  //
  // `credentials: true` is required, not optional. Auth is a **cookie**
  // (`house_session`), and a browser will only send and accept a cross-origin
  // cookie when the response carries `Access-Control-Allow-Credentials: true`
  // alongside a specific origin. Without it the Android app gets 401 on every
  // request and its login silently fails, even though the origin is allowed.
  //
  // This is why the allow-list above is an explicit array and must never become
  // `true`/wildcard: `Access-Control-Allow-Origin: *` is illegal alongside
  // credentials, so a wildcard here would break the app *and* widen access.
  await app.register(cors, {
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
    origin: [
      "http://localhost:5173",
      "http://localhost:3000",
      // Capacitor's local WebView origin (Android).
      //
      // BOTH schemes are listed, and they are not interchangeable. Capacitor's
      // default is `https`, but `capacitor.config.ts` sets `androidScheme:
      // "http"` so that a plain-HTTP LAN address is same-scheme rather than
      // mixed content (decisions/014). That moves the app's origin from
      // `https://localhost` to `http://localhost`, and CORS compares the origin
      // as a whole -- so dropping the https entry when the scheme changed breaks
      // every API call on the device with a bare `TypeError: Failed to fetch`,
      // while the cause is a CORS rejection that is invisible from inside a
      // fetch() promise. Keeping both means either scheme works.
      "https://localhost",
      "http://localhost",
      "https://books.home.arpa",
      // Capacitor's iOS origin. Not a target platform, but the same app code
      // would hit it, and the cost of allowing it is nil.
      "capacitor://localhost",
    ],
  });
  await app.register(cookie);

  // Auth gate.
  //
  // Only `/api/` is gated. The client has to load its login screen before it
  // has a session, so `/`, `/assets/*` and the SPA fallback are public. This
  // also fixes the production case where `@fastify/static` was behind the same
  // hook as the API and the first request for `/` came back 401.
  //
  // The token is accepted from a header OR the cookie, because the two shells
  // have genuinely different constraints and only one of them can use a cookie:
  //
  //  - Browser / PWA: same-origin, so the cookie works and is the better choice
  //    (HttpOnly, so script cannot read it).
  //  - Android WebView: origin is `https://localhost` but the API is plain
  //    `http://<address>:3000`. Different scheme means *cross-site*, and a
  //    `SameSite=Lax` cookie is never stored or sent there -- Chrome rejected it
  //    outright (CDP confirmed zero cookies present), so every call after login
  //    returned 401. CORS and `credentials: 'include'` cannot fix that; the
  //    cookie policy does. `SameSite=None` would need `Secure`, i.e. real HTTPS,
  //    which a plain-HTTP LAN server does not have.
  //
  // So the native shell sends the token as a header instead. It is the same
  // opaque random value, compared the same way -- this widens *how* a token is
  // presented, not *who* may present one.
  //
  // Browser media uses its HttpOnly cookie. The Android shell uses a
  // five-minute, profile- and resource-scoped media token in the URL because
  // native media requests cannot consistently carry the session header.
  app.decorateRequest("auth", null);
  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?")[0];
    if (!path.startsWith("/api/")) return;
    if (request.method === "OPTIONS") return;
    // The admin panel has a separate listener and route table. Do not let the
    // household auth gate turn its absent routes into a misleading 401.
    if (path === "/api/admin" || path.startsWith("/api/admin/")) {
      if (options.adminProxyTarget) return;
      return fail(reply, 404, "not_found");
    }
    if (!authEnabled) return;

    const mediaResource = mediaResourceFromPath(path);
    if (mediaResource) {
      const query = request.query as Record<string, unknown> | undefined;
      if (verifyMediaToken(mediaTokenSecret, query?.media, mediaResource)) return;
    }

    const token = sessionTokenFromRequest(request);
    if (token) request.auth = await auth.validate(token);

    // Public API paths (login, signup, providers, health, OAuth flows) need no
    // session. This short-circuit must come before the auth check below so that
    // a login request is not rejected for lacking one.
    if (isPublicApiPath(path)) return;

    // A pre-demo household/break-glass session has no account scope. It used to
    // be thrown away outright in demo mode, which severed the household break-
    // glass key the operator configures on the production demo host: a listener
    // who reached for that key was refused at login (404) or, with a session
    // already in flight, discarded here, and the app could not tell the difference
    // between "the password is wrong" and "this server does not take one".
    // Household sessions simply carry no account scope, so the demo account
    // routes (which require a session-bound profile) stay unreachable for them.
    // The decision is recorded in spec 33; local behaviour is unchanged.
    if (!request.auth) return fail(reply, 401, "auth_required");
    if (isDemoMode(accountExperience) && isAdminRoute(request.method, path)) {
      return fail(reply, 404, "not_found");
    }
    if (isAdminRoute(request.method, path) && request.auth.role !== "admin") {
      return fail(reply, 403, "forbidden");
    }
  });

  const adminProxyTarget = options.adminProxyTarget ? new URL(options.adminProxyTarget) : null;
  if (adminProxyTarget && !["127.0.0.1", "[::1]", "localhost"].includes(adminProxyTarget.hostname)) {
    throw new Error("adminProxyTarget must point to a loopback address");
  }
  const proxyAdminRequest = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!adminProxyTarget) return fail(reply, 404, "not_found");
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
      const upstream = await fetch(new URL(upstreamPath, adminProxyTarget), {
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

  await registerAuthRoutes(app, auth, {
    secureCookie,
    accountExperience,
    accountExperienceResolver: () => accountExperience,
    emailSignUpAllowed: isDemoMode(accountExperience),
  });
  await registerPasskeyRoutes(app, passkeys, auth, {
    secureCookie,
    accountExperience,
    accountExperienceResolver: () => accountExperience,
  });

  // Serve the built client (production single-origin). In dev the Vite dev
  // server runs separately on :5173, so this only kicks in when client/dist exists.
  const { existsSync } = await import("node:fs");
  const clientDist = process.env.CLIENT_DIST || path.resolve(__dirname, "../../client/dist");
  if (existsSync(clientDist)) {
    const fastifyStatic = (await import("@fastify/static")).default;
    await app.register(fastifyStatic, {
      root: clientDist,
      prefix: "/",
      wildcard: false,
      setHeaders: (reply, filePath) => {
        reply.header("Cache-Control", cacheControlForPath(filePath));
      },
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        return fail(reply, 404, "not_found");
      }
      // Spec 38 lesson (2026-11-13): index.html for a missing bundle turns a
      // stale deploy into a silent blank page. Asset misses fail loudly.
      if (isAssetRequest(request.url)) {
        return fail(reply, 404, "not_found");
      }
      reply.sendFile("index.html");
    });
  }

  const optionalProfileId = makeOptionalProfileId(accountExperience);
  const requireAccountProfileId = makeRequireAccountProfileId(accountExperience);
  const requireProfileId = makeRequireProfileId(accountExperience);
  const canReadMediaItem = createCanReadMediaItem({ prisma, authEnabled, accountExperience, mediaTokenSecret });

  // Wire the route modules.
  const oauthProviders = auth.oauth.enabled
    ? auth.oauth.providers.map((provider) => provider.id)
    : [];
  await registerStaticRoutes(app, { accountExperience, oauthProviders });
  await registerMediaRoutes(app, { prisma, authEnabled, accountExperience, mediaTokenSecret, parseIdParam, optionalProfileId, requireAccountProfileId, canReadMediaItem });
  await registerLibraryRoutes(app, { prisma, accountExperience, scanner, enrichment, logger: app.log, parseIdParam, optionalProfileId, requireProfileId, requireAccountProfileId, canReadMediaItem, sendConditional });
  await registerEnrichmentRoutes(app, { prisma, accountExperience, enrichment, parseIdParam, canReadMediaItem });
  await registerTaxonomyRoutes(app, { prisma, accountExperience, parseIdParam, optionalProfileId });
  await registerMetadataRoutes(app, { prisma, accountExperience, parseIdParam, canReadMediaItem, llm: options.llm });
  await registerDiscoverRoutes(app, { prisma, accountExperience, recommendations, parseIdParam, requireProfileId });
  await registerBuyContextRoutes(app, { accountExperience, requireProfileId });
  await registerProgressRoutes(app, { prisma, parseIdParam, requireProfileId });
  await registerProfilesRoutes(app, { prisma, accountExperience, authEnabled, parseIdParam, requireProfileId });
  await registerGdprRoutes(app, { prisma, parseIdParam, requireProfileId });

  return app;
}
