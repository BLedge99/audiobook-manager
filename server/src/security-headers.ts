import type { FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";

/**
 * Response headers for every listener this app serves (the family port and the
 * admin port). One shared policy so the two surfaces cannot drift.
 *
 * Deliberate relaxations from helmet defaults:
 * - crossOriginResourcePolicy: cross-origin — media and cover responses must be
 *   loadable by the Android WebView (origin https://localhost) from the plain-HTTP
 *   home server, and by provider <img> tags in the browser SPA.
 * - crossOriginEmbedderPolicy: off — requiring CORP on our documents would block
 *   every cross-origin provider image (OpenLibrary covers send no CORP header).
 * - HSTS without includeSubDomains — books.home.arpa lives on a shared home domain;
 *   forcing HTTPS on every *.home.arpa name is not this app's call.
 * - style-src allows 'unsafe-inline' — React inline style attributes; no user HTML
 *   is ever rendered (all API text goes through React's escaping).
 * - script-src has no 'unsafe-inline' — the SPA's inline theme bootstrap lives in
 *   /theme-init.js for exactly this reason.
 */
export async function registerSecurityHeaders(app: FastifyInstance): Promise<void> {
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        mediaSrc: ["'self'", "blob:", "https:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    frameguard: { action: "deny" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
    strictTransportSecurity: { maxAge: 15_552_000, includeSubDomains: false },
  });
}
