import type { AuthContext } from "./service";

/**
 * Which routes belong to the operator, not the listener (spec 28).
 *
 * The list is path-based on purpose. The alternative -- a `preHandler` on every
 * route -- is easy to forget on the next route, and a forgotten guard is a
 * privilege bug. The cost is that this file must be read whenever a new admin
 * surface is added; the route tests in `auth.test.ts` cover the important ones.
 */
export function isAdminRoute(method: string, path: string): boolean {
  if (
    path === "/api/library-roots" ||
    path.startsWith("/api/library-roots/") ||
    path === "/api/scan" ||
    path.startsWith("/api/scan/") ||
    path === "/api/enrichment" ||
    path.startsWith("/api/enrichment/") ||
    path === "/api/metadata/reset-all"
  ) {
    return true;
  }

  // Profile management: the account picker needs GET; creating and removing are
  // operator actions.
  if (path === "/api/profiles" && method !== "GET") return true;
  if (path.startsWith("/api/auth/accounts/") && method !== "GET") return true;

  // The taxonomy and tag vocabulary are household-managed. Reading them is
  // part of browsing.
  if (path === "/api/genres" && method !== "GET") return true;
  if (path.startsWith("/api/genres/") && method !== "GET") return true;
  if (path === "/api/tags" && method !== "GET") return true;
  if (path.startsWith("/api/tags/") && method !== "GET") return true;

  // Enrichment and metadata editing on a book.
  if (/^\/api\/audiobooks\/\d+\/(enrich|candidates|metadata)(\/|$)/.test(path)) return true;
  if (/^\/api\/audiobooks\/\d+\/tags$/.test(path) && method === "PUT") return true;
  if (/^\/api\/audiobooks\/\d+\/ai-suggest$/.test(path)) return true;
  if (/^\/api\/tracks\/\d+\/title$/.test(path) && method === "PUT") return true;

  return false;
}

/** Admin actions are open only when auth is disabled (development). */
export function mayAdmin(context: AuthContext | null, authEnabled: boolean): boolean {
  return !authEnabled || context?.role === "admin";
}
