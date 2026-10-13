/**
 * API base URL resolution (spec 26, Sprint 2).
 *
 * ## Why this exists
 *
 * The client was written against **relative** URLs -- `/api/audiobooks` --
 * because in Docker the Vite dev server sits in front of the Fastify server and
 * proxies them. That is fine in a browser and useless in the Android shell:
 * there is no proxy, and a relative URL from the WebView's `https://localhost`
 * origin resolves to the *phone*, so every request 404s against the bundled
 * `index.html` fallback.
 *
 * So the base is now explicit:
 *
 * | Shell | Server URL | Result |
 * |---|---|---|
 * | Browser / dev | unset | `/api/audiobooks` (unchanged) |
 * | Android | `http://192.168.1.203:3000` | `http://192.168.1.203:3000/api/audiobooks` |
 *
 * Empty means "relative", which keeps every existing browser test and the PWA
 * exactly as they were. This is also what replaces the hardcoded `server.url`
 * in `capacitor.config.ts`, so a DHCP-assigned IP change no longer needs a
 * rebuild.
 *
 * ## Why localStorage and not Dexie
 *
 * The URL has to be readable *before* the database opens -- it decides which
 * server the replica syncs from -- and a synchronous read keeps `apiUrl()` free
 * of `await` in every call site. It is a few dozen bytes of configuration, not
 * library metadata, so the IndexedDB write amplification of storing it there
 * would buy nothing.
 */

import { isNativeShell } from "./platform";

export const SERVER_URL_KEY = "serverUrl";

/**
 * Clean a user-typed server URL into something usable, or "" if there is
 * nothing usable.
 *
 * Forgiving about the trailing slash and a missing scheme, because on a phone
 * the realistic typo is `192.168.1.203:3000` with no `http://`, and rejecting
 * that with a validation error would be unhelpful for a household user.
 *
 * Returns "" for input that cannot be repaired into a URL. Callers treat "" as
 * "not configured", which is also what an unset value means.
 */
export function normaliseServerUrl(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;

  try {
    const url = new URL(withScheme);
    // `new URL("http://")` parses but has no host, which would produce
    // requests to "http:///api/audiobooks" that fail confusingly later.
    if (!url.hostname) return "";
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return "";
  }
}

function readStored(): string {
  if (typeof window === "undefined") return "";
  try {
    return normaliseServerUrl(window.localStorage.getItem(SERVER_URL_KEY));
  } catch {
    // Private mode / storage disabled. Treat as unconfigured rather than
    // throwing during render.
    return "";
  }
}

/** The configured server origin, or "" when unset (browser/dev/PWA). */
export function getServerUrl(): string {
  return readStored();
}

/** Persist the server URL. Throws if `url` is not a usable URL. */
export function setServerUrl(url: string): void {
  const normalised = normaliseServerUrl(url);
  if (!normalised) throw new Error("Enter a server address, for example http://192.168.1.203:3000");
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SERVER_URL_KEY, normalised);
}

export function clearServerUrl(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SERVER_URL_KEY);
}

/**
 * Turn an API path into a URL the current shell can actually fetch.
 *
 * With no server configured this returns the path unchanged, which is what
 * keeps the browser and dev-server behaviour identical to before spec 26.
 */
export function apiUrl(path: string): string {
  const base = getServerUrl();
  if (!base) return path;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/** True when the app has a server it could talk to. */
export function hasServerUrl(): boolean {
  return getServerUrl() !== "";
}

/**
 * True when the Android shell has no server configured, which is the state
 * that makes the app unusable rather than merely degraded -- there is nothing
 * to download from and no way to fix it from the UI.
 */
export function needsServerUrl(): boolean {
  return isNativeShell() && !hasServerUrl();
}

/**
 * Resolve the URL a `fetch` call should actually use.
 *
 * Exported and pure so it can be unit-tested -- the installer below is a
 * side-effecting wrapper around it, and the interesting decisions (what counts
 * as relative, what must never be touched) live here where tests can reach them.
 *
 * The strictness matters: `apiUrl` would happily prepend the server origin to
 * an already-absolute URL, so a naive wrapper would turn
 * `fetch("http://192.168.1.203:3000/api/x")` into
 * `http://192.168.1.203:3000/http://192.168.1.203:3000/api/x`. Anything with a
 * scheme is therefore passed through untouched.
 */
export function resolveApiRequest(input: RequestInfo | URL): RequestInfo | URL {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : null;
  if (url === null) return input;

  // Already absolute (http, https, capacitor-file, blob, data...). Leave alone.
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return input;

  // Protocol-relative ("//host/path") must be checked *before* the bare-path
  // branch: it also starts with "/", so it would otherwise be rewritten into
  // "<server>//example.com/x", which is not a URL anyone meant to request.
  if (url.startsWith("//")) return input;

  // Bare path such as "/api/audiobooks": the case this exists to fix.
  if (url.startsWith("/")) return apiUrl(url);

  return input;
}

const INSTALL_FLAG = "__audiobookApiBaseInstalled";

/**
 * Make every `fetch` in the app resolve `/api/...` against the configured
 * server.
 *
 * A deliberate alternative to editing all fourteen modules that call `fetch`.
 * Those call sites are correct as written -- they say what they want, not where
 * the server lives -- and centralising the base here is the same idea as
 * axios's `baseURL`, without adding axios.
 *
 * Idempotent: installing twice would double-wrap and call the shim from the
 * shim, so it is guarded. Call once at startup, before anything fetches.
 */
export function installApiBaseUrl(): void {
  if (typeof window === "undefined") return;
  const scope = window as unknown as Record<string, unknown>;
  if (scope[INSTALL_FLAG]) return;

  const original = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    original(resolveApiRequest(input) as RequestInfo, init)) as typeof window.fetch;

  scope[INSTALL_FLAG] = true;
}

/** The profile header the server scopes progress and favourites by. */
export function profileHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const profileId = window.localStorage.getItem("profileId");
  return profileId ? { "x-profile-id": profileId } : {};
}

/**
 * Fetch a JSON response from the API, with the profile header attached.
 *
 * Throws with the server's message where there is one, matching what the
 * per-hook `request` helpers have always done, so error text shown to the user
 * does not change shape when this replaces them.
 */
export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...profileHeaders() };
  if (options?.body) headers["Content-Type"] = "application/json";
  const response = await fetch(apiUrl(path), {
    ...options,
    headers: { ...headers, ...(options?.headers as Record<string, string> | undefined) },
  });

  if (!response.ok) {
    const body = await response.text();
    let message = body;
    try {
      message = JSON.parse(body).message || body;
    } catch {
      /* not JSON; the raw body is the best message available */
    }
    throw new Error(message || `Request failed (${response.status})`);
  }

  return response.status === 204 ? (undefined as T) : response.json();
}

/**
 * Resolve a relative asset URL (cover art, audio) for the current shell.
 *
 * Cover URLs come back from the server as `/api/covers/...`. In a browser they
 * resolve against the dev server, which proxies them. In the Android shell
 * they must be pointed at the configured server explicitly.
 */
export function apiAssetUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return apiUrl(path);
}