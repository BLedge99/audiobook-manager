import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import path from "node:path";
import { existsSync } from "node:fs";
import { cacheControlForPath, isAssetRequest } from "../static-assets";

/**
 * The parts both server listeners must carry, written once (spec 41 step 9.4).
 *
 * The family listener (`app.ts`) and the admin listener (`admin/app.ts`) are
 * deliberately separate processes with separate auth (ADR 022/029), but the
 * things that make them one deployment — which browser origins may call, how
 * the client SPA is served, and how /api routes are documented — are the same
 * deployment facts. Drifting twice used to mean fixing the spec-38 blank-page
 * lesson twice.
 */

/** The CORS allow-list. Never a wildcard — see app.ts for why. */
export const SHARED_CORS_ORIGINS: readonly string[] = Object.freeze([
  "http://localhost:5173",
  "http://localhost:3000",
  // Capacitor's WebView origins, both schemes; see app.ts and decisions/014.
  "https://localhost",
  "http://localhost",
  "https://books.home.arpa",
  "capacitor://localhost",
]);

/** The allow-list, optionally widened by one configured extra (deduped). */
export function sharedCorsOrigins(extra: string[] = []): string[] {
  return [...new Set([...SHARED_CORS_ORIGINS, ...extra])];
}

/** Record every `/api/` route for the admin API-docs screen. */
export function collectApiDocs(app: FastifyInstance): void {
  const apiDocs: { method: string | string[]; url: string; schema: unknown }[] = [];
  app.decorate("apiDocs", apiDocs);
  app.addHook("onRoute", (route) => {
    if (route.url.startsWith("/api/")) {
      apiDocs.push({ method: route.method, url: route.url, schema: route.schema ?? {} });
    }
  });
}

export interface ClientDistOptions {
  distDir: string;
  /** Answer /api/* misses — the two listeners keep their own error shapes. */
  apiNotFound(request: FastifyRequest, reply: FastifyReply): unknown;
}

/**
 * Serve the built client SPA with the shared cache policy and the shared
 * not-found rules. Returns whether a dist was found and registered; callers
 * decide what a missing dist means for them (the family listener registers
 * nothing in dev; the admin listener registers its own 404 fallback).
 *
 * - hashed /assets: immutable for a year; index.html: must-revalidate;
 * - /api/* misses go to `apiNotFound`, never to the SPA;
 * - a missing asset answers 404 as JSON, never index.html (spec 38);
 * - a `distDir` without `index.html` is no dist — both listeners 404 cleanly
 *   (or register nothing) rather than 500ing on the front door.
 */
export async function registerClientDist(
  app: FastifyInstance,
  options: ClientDistOptions,
): Promise<boolean> {
  const ready = existsSync(path.join(options.distDir, "index.html"));
  if (!ready) return false;

  const fastifyStatic = (await import("@fastify/static")).default;
  await app.register(fastifyStatic, {
    root: options.distDir,
    prefix: "/",
    wildcard: false,
    setHeaders: (reply, filePath) => {
      reply.header("Cache-Control", cacheControlForPath(filePath));
    },
  });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) {
      return options.apiNotFound(request, reply);
    }
    // Spec 38 lesson (2026-11-13): index.html for a missing bundle turns a
    // stale deploy into a silent blank page. Asset misses fail loudly.
    if (isAssetRequest(request.url)) {
      return reply.code(404).send({ error: "not_found" });
    }
    return reply.sendFile("index.html");
  });
  return true;
}
