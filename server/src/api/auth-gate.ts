import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { fail } from "../http-errors";
import type { AuthService } from "../auth/service";
import { isAdminRoute } from "../auth/policy";
import { mediaResourceFromPath, verifyMediaToken } from "../auth/media-token";
import { sessionTokenFromRequest } from "../auth/session";

export interface AuthGateOptions {
  auth: AuthService;
  authEnabled: boolean;
  /** Test seam; production reads `MEDIA_TOKEN_SECRET` from the environment. */
  mediaTokenSecret: string | undefined;
  accountExperience: "household" | "demo";
  /** Loopback admin listener proxy target; absent when the listener is off. */
  adminProxyTarget: URL | null;
}

/** Public API paths; everything else under `/api/` needs a session. */
export function isPublicApiPath(path: string): boolean {
  // `/api/auth/:provider/authorize` and `/api/auth/:provider/callback` are the
  // two legs of an OAuth flow that must complete before a session exists
  // (spec 32 / ADR 023). They carry no credentials; the authorize leg redirects
  // away to the provider and the callback leg answers the provider.
  const rest = path.slice("/api/auth".length);
  const segments = rest.split("/").filter(Boolean);
  const isOAuthFlowPath = segments.length === 2 && (segments[1] === "authorize" || segments[1] === "callback");
  return (
    path === "/api/health" ||
    path === "/api/config" ||
    path === "/api/auth/login" ||
    path === "/api/auth/signup" ||
    path === "/api/auth/providers" ||
    path === "/api/auth/accounts" ||
    path === "/api/auth/claim" ||
    path === "/api/auth/logout" ||
    path === "/api/auth/devices/session" ||
    path.startsWith("/api/auth/passkeys/login/") ||
    isOAuthFlowPath
  );
}

/**
 * The household auth gate: validate the session token, honour the public API
 * allow-list, resolve profile scope, and hold the admin listener back behind
 * its own loopback-only proxy.
 *
 * Extracted from the app module as part of the app-module split; behaviour is
 * unchanged (spec 33 / ADR 016).
 */
export function registerAuthGate(app: FastifyInstance, options: AuthGateOptions): void {
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
    if (!options.authEnabled) return;

    const mediaResource = mediaResourceFromPath(path);
    if (mediaResource) {
      const query = request.query as Record<string, unknown> | undefined;
      if (verifyMediaToken(options.mediaTokenSecret, query?.media, mediaResource)) return;
    }

    const token = sessionTokenFromRequest(request);
    if (token) request.auth = await options.auth.validate(token);

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
    if (options.accountExperience === "demo" && isAdminRoute(request.method, path)) {
      return fail(reply, 404, "not_found");
    }
    if (isAdminRoute(request.method, path) && request.auth.role !== "admin") {
      return fail(reply, 403, "forbidden");
    }
  });
}
