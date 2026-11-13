/**
 * The demo policy in one place (spec 37, step 7.6).
 *
 * Before this module the production demo's rules lived in three shapes:
 * inline `accountExperience === "demo"` checks in handlers, a `demoMode()`
 * closure duplicated in the auth route modules, and the public-path
 * allowlist in the auth gate. Two of them disagreed: two routes answered
 * 401 where every other demo-hidden route answered 404.
 *
 * `DEMO_POLICY_TABLE` is the single table. Entries say whether a path needs
 * no session (`publicApi`) and/or answers 404 in demo mode (`hiddenInDemo`).
 * The gate reads `isPublicApiPath`; every module reads `isDemoMode`; the
 * policy test injects every `hiddenInDemo` entry. The allowlist and the
 * hidden set can never drift apart.
 */

/** The account surface; defaults household for safety. */
export type AccountExperience = "household" | "demo";

/** One predicate answers "is this server in the public demo". */
export const isDemoMode = (experience: AccountExperience | null | undefined): boolean =>
  experience === "demo";

export interface DemoPolicyEntry {
  label: string;
  /** HTTP method, or "*" for path-wide (the public allowlist is method-agnostic, as it always was). */
  method: string;
  /** Matches the request path without the query string. */
  path: RegExp;
  /** A concrete example of the path, used by the policy test. */
  example: string;
  /** Minimal valid body for the policy test. */
  payload?: Record<string, unknown>;
  /** The auth gate lets these through with no session at all. */
  publicApi: boolean;
  /** In production demo mode the handler answers 404 without doing any work. */
  hiddenInDemo: boolean;
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "/api/x/:id/y" -> /^\/api\/x\/[^/]+\/y$/ (param segments become a path-token match). */
const pattern = (template: string): RegExp =>
  new RegExp(`^${escapeRegExp(template).replace(/:[^/]+/g, "[^/]+")}$`);

const hidden = (label: string, method: string, template: string, payload?: Record<string, unknown>): DemoPolicyEntry => ({
  label,
  method,
  path: pattern(template),
  example: template.replace(/:id/g, "1").replace(/:provider/g, "google"),
  payload,
  publicApi: false,
  hiddenInDemo: true,
});

export const DEMO_POLICY_TABLE: readonly DemoPolicyEntry[] = [
  // --- Public allowlist (the auth gate lets these through with no session) ---
  { label: "health", method: "GET", path: pattern("/api/health"), example: "/api/health", publicApi: true, hiddenInDemo: false },
  { label: "config", method: "GET", path: pattern("/api/config"), example: "/api/config", publicApi: true, hiddenInDemo: false },
  { label: "login", method: "POST", path: pattern("/api/auth/login"), example: "/api/auth/login", payload: { password: "anything" }, publicApi: true, hiddenInDemo: false },
  { label: "signup", method: "POST", path: pattern("/api/auth/signup"), example: "/api/auth/signup", payload: { email: "a-b@example.com", password: "long-enough-pass" }, publicApi: true, hiddenInDemo: false },
  { label: "providers", method: "GET", path: pattern("/api/auth/providers"), example: "/api/auth/providers", publicApi: true, hiddenInDemo: false },
  { label: "logout", method: "POST", path: pattern("/api/auth/logout"), example: "/api/auth/logout", publicApi: true, hiddenInDemo: false },
  { label: "oauth flow", method: "*", path: /^\/api\/auth\/[^/]+\/(authorize|callback)$/, example: "/api/auth/google/authorize", publicApi: true, hiddenInDemo: false },
  { label: "oauth handoff", method: "POST", path: pattern("/api/auth/oauth/handoff"), example: "/api/auth/oauth/handoff", payload: { code: "example", state: "example" }, publicApi: true, hiddenInDemo: false },

  // Public, but hidden in the demo: callable without a session, answers 404 there.
  { label: "register-profile", method: "POST", path: pattern("/api/auth/register-profile"), example: "/api/auth/register-profile", payload: { name: "Hidden", householdPassword: "hh", password: "pp" }, publicApi: true, hiddenInDemo: true },
  { label: "accounts list", method: "GET", path: pattern("/api/auth/accounts"), example: "/api/auth/accounts", publicApi: true, hiddenInDemo: true },
  { label: "claim", method: "POST", path: pattern("/api/auth/claim"), example: "/api/auth/claim", payload: { profileId: 1, householdPassword: "hh", newPassword: "pp" }, publicApi: true, hiddenInDemo: true },
  { label: "device session", method: "POST", path: pattern("/api/auth/devices/session"), example: "/api/auth/devices/session", payload: { secret: "0123456789abcdef0123456789" }, publicApi: true, hiddenInDemo: true },
  { label: "passkey login", method: "POST", path: /^\/api\/auth\/passkeys\/login\/[^/]+$/, example: "/api/auth/passkeys/login/options", payload: {}, publicApi: true, hiddenInDemo: true },

  // --- Demo-hidden routes (404 without doing any work) ---
  hidden("scan trigger", "POST", "/api/scan", {}),
  hidden("scan status", "GET", "/api/scan/status"),
  hidden("library roots list", "GET", "/api/library-roots"),
  hidden("library root create", "POST", "/api/library-roots", {}),
  hidden("library root delete", "DELETE", "/api/library-roots/:id"),
  hidden("genre create", "POST", "/api/genres", { slug: "hidden-test", name: "Hidden" }),
  hidden("genre update", "PATCH", "/api/genres/:id", { name: "Hidden" }),
  hidden("genre delete", "DELETE", "/api/genres/:id"),
  hidden("tag create", "POST", "/api/tags", { name: "Hidden Tag" }),
  hidden("tag rename", "PATCH", "/api/tags/:id", { name: "Hidden Rename" }),
  hidden("tag delete", "DELETE", "/api/tags/:id"),
  hidden("tag merge", "POST", "/api/tags/:id/merge", { targetTagId: 1 }),
  hidden("enrich book", "POST", "/api/audiobooks/:id/enrich"),
  hidden("enrichment run", "POST", "/api/enrichment/run", {}),
  hidden("enrichment status", "GET", "/api/enrichment/status"),
  hidden("enrichment review queue", "GET", "/api/enrichment/review-queue"),
  hidden("metadata candidates", "GET", "/api/audiobooks/:id/candidates"),
  hidden("metadata confirm", "POST", "/api/audiobooks/:id/metadata", {}),
  hidden("tag suite save", "PUT", "/api/audiobooks/:id/tags", {}),
  hidden("metadata reset", "POST", "/api/audiobooks/:id/metadata/reset"),
  hidden("ai suggest", "POST", "/api/audiobooks/:id/ai-suggest"),
  hidden("profiles list", "GET", "/api/profiles"),
  hidden("profile create", "POST", "/api/profiles", {}),
  hidden("profile delete", "DELETE", "/api/profiles/:id"),
  hidden("device enrol", "POST", "/api/auth/devices", {}),
  hidden("device link", "POST", "/api/auth/devices/link", {}),
  hidden("device list", "GET", "/api/auth/devices"),
  hidden("device revoke", "DELETE", "/api/auth/devices/:id"),
  hidden("password reset", "POST", "/api/auth/accounts/:id/reset", { newPassword: "pp" }),
  hidden("passkey register options", "POST", "/api/auth/passkeys/register/options"),
  hidden("passkey register verify", "POST", "/api/auth/passkeys/register/verify", { response: {} }),
  hidden("passkey list", "GET", "/api/auth/passkeys"),
  hidden("passkey delete", "DELETE", "/api/auth/passkeys/:id"),
];

/** Public API paths; everything else under `/api/` needs a session. */
export function isPublicApiPath(path: string): boolean {
  return DEMO_POLICY_TABLE.some((entry) => entry.publicApi && entry.path.test(path));
}

/** Is this method+path hidden in the production demo (answers 404)? */
export function isDemoHiddenRoute(method: string, path: string): boolean {
  return DEMO_POLICY_TABLE.some(
    (entry) => entry.hiddenInDemo && (entry.method === "*" || entry.method === method.toUpperCase()) && entry.path.test(path),
  );
}

/** The demo-hidden entries, for the policy test. */
export function demoHiddenRoutes(): readonly DemoPolicyEntry[] {
  return DEMO_POLICY_TABLE.filter((entry) => entry.hiddenInDemo);
}
