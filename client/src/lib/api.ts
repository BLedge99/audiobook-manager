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
import { copy } from "../copy";
import { responseErrorText } from "./apiError";

export const SERVER_URL_KEY = "serverUrl";

/** Storage key for the household session token sent as a header. */
export const SESSION_TOKEN_KEY = "houseSessionToken";

/** The header the server accepts the session token in (see server `app.ts`). */
export const SESSION_HEADER = "x-house-session";

/**
 * Persist the session token returned by `/api/auth/login`.
 *
 * ## Why a token and not just the cookie
 *
 * The browser/PWA is same-origin with the API, so the `house_session` cookie
 * works there and is HttpOnly. The Android WebView is not: its origin is
 * `https://localhost` while the API is plain `http://<address>:3000`, and the
 * differing scheme makes it *cross-site*, so a `SameSite=Lax` cookie is never
 * stored or sent. Every post-login call 401'd, and the login appeared to
 * succeed.
 *
 * `SameSite=None` would fix that but requires `Secure`, i.e. real HTTPS, which
 * a plain-HTTP LAN server does not have. So the token is also returned in the
 * login response body and sent as a header. The cookie still works and is still
 * set; this is an additional path, not a replacement.
 */
export function setSessionToken(token: string | undefined | null): void {
  if (typeof window === "undefined") return;
  try {
    if (token) window.localStorage.setItem(SESSION_TOKEN_KEY, token);
    else window.localStorage.removeItem(SESSION_TOKEN_KEY);
  } catch {
    // Private mode / storage disabled. The cookie path may still work.
  }
}

function readSessionToken(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(SESSION_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

/**
 * True when the caller already set the header.
 *
 * `init.headers` may be a plain object, an array of pairs, or a `Headers`
 * instance, and all three are legal, so a plain `in` check would be wrong for
 * two of them. Getting this wrong would either drop the token or send it twice.
 */
function hasHeader(headers: unknown, name: string): boolean {
  if (!headers) return false;
  const target = name.toLowerCase();
  if (typeof (headers as Headers).has === "function") return (headers as Headers).has(name);
  if (Array.isArray(headers)) return headers.some((pair) => Array.isArray(pair) && String(pair[0]).toLowerCase() === target);
  if (typeof headers === "object") return Object.keys(headers as Record<string, string>).some((k) => k.toLowerCase() === target);
  return false;
}

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
  if (!normalised) throw new Error(copy.operator.settings.enterAddress);
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
 *
 * ## Why credentials are set here rather than only in `apiFetch`
 *
 * `credentials: "include"` is what lets the `house_session` cookie cross
 * origins from the Android WebView (`https://localhost` -> the LAN server).
 *
 * It was originally added to `apiFetch` alone, which looked correct and had a
 * passing unit test -- but `apiFetch` is barely called. The app has ~8
 * near-identical private `request` helpers (`useLibrary`, `useBrowse`,
 * `ReviewQueue`, `TagManager`, ...) plus raw `fetch` calls in `LoginGate`,
 * `ProfileGate`, `ProfileSwitcher`, `ChapterPlayer` and `AudiobookDetail`. None
 * of them route through `apiFetch`, so the cookie still did not travel and the
 * app still 401'd. The test passed and proved nothing.
 *
 * This shim is the only choke point every one of those calls passes through,
 * so setting it here is what actually fixes the app. `apiFetch` keeps its own
 * explicit `credentials` so it is correct even if the shim is not installed.
 */
export function installApiBaseUrl(): void {
  if (typeof window === "undefined") return;
  const scope = window as unknown as Record<string, unknown>;
  if (scope[INSTALL_FLAG]) return;

  const original = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    // Attach the session token here rather than at each call site. The app has
    // ~8 duplicated private `request` helpers plus raw `fetch` calls, so any
    // per-call-site approach silently misses most of them -- that is exactly how
    // the first attempt at this fix shipped a passing test and a broken app.
    const token = readSessionToken();
    const headers: Record<string, string> = { ...(init?.headers as Record<string, string> | undefined) };
    if (token && !hasHeader(headers, SESSION_HEADER)) headers[SESSION_HEADER] = token;
    return original(resolveApiRequest(input) as RequestInfo, {
      ...init,
      headers: token ? headers : init?.headers,
      // See the long note below: this, not `apiFetch`, is the only place a
      // credentialed fetch can be guaranteed, because most call sites never go
      // through `apiFetch`.
      credentials: "include",
    });
  }) as typeof window.fetch;

  scope[INSTALL_FLAG] = true;
}

/** The profile header the server scopes progress and favourites by. */
export function profileHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const profileId = window.localStorage.getItem("profileId");
  return profileId ? { "x-profile-id": profileId } : {};
}

/**
 * A fetch that always finishes.
 *
 * ## Why this exists
 *
 * A `fetch` to an unreachable host does not always fail — it **hangs**. A stale
 * DHCP address on a network that blackholes packets never sends a RST, so the
 * request sits in CONNECT for tens of seconds or more. Every request in the app
 * that had no bound could therefore leave a spinner running forever, and the
 * one that mattered most — the reachability probe — left the whole app on the
 * "Connecting…" splash with no way out. That is precisely the case the
 * offline path exists to handle: the point of downloading a book is to listen
 * to it with no network.
 *
 * So every request gets a deadline, and a request that runs out of time
 * fails like any other error — which the callers already know how to show.
 *
 * The default is generous, because a slow home server on a phone is still a
 * working server. The reachability probe uses a shorter one; see
 * `lib/reachability.ts`.
 */
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * `fetch`, with a deadline.
 *
 * The signal is composed rather than replaced, so a caller that already set
 * one keeps it.
 *
 * **Not every call site uses this yet.** The per-component `request` helpers
 * in `ReviewQueue`, `TagManager`, `AudiobookDetail` and the gates still use a
 * raw `fetch`, and each of them can still spin forever when the server is
 * unreachable. `LIMITATIONS.md` §5 records that as the remaining work.
 */
export async function boundedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const outer = init.signal;
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener("abort", () => controller.abort());
  }
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch a JSON response from the API, with the profile header attached.
 *
 * Throws with the reviewed sentence for the server's error code, so the text a
 * person reads always comes from the catalog (`specs/15b` feature 7b) rather
 * than from whatever prose the server happened to send.
 */
export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...profileHeaders() };
  if (options?.body) headers["Content-Type"] = "application/json";
  const response = await boundedFetch(apiUrl(path), {
    // The session cookie only crosses origins when the client opts in with
    // `credentials: "include"`. Without it every cross-origin call -- which is
    // every call from the Android shell's https://localhost WebView -- gets no
    // cookie and so 401s even though the user "logged in". The server must also
    // send `Access-Control-Allow-Credentials: true` with a specific origin
    // (never `*`), which it does since the same fix landed server-side.
    credentials: "include",
    ...options,
    headers: { ...headers, ...(options?.headers as Record<string, string> | undefined) },
  });

  if (!response.ok) {
    throw new Error(await responseErrorText(response));
  }

  return response.status === 204 ? (undefined as T) : response.json();
}

/**
 * Headers for a native plugin request (Filesystem.downloadFile).
 *
 * These bypass the `fetch` shim, so anything they need must be attached here.
 */
export function sessionHeaders(): Record<string, string> {
  const token = readSessionToken();
  const profileId = typeof window === "undefined" ? null : window.localStorage.getItem("profileId");
  return {
    ...(token ? { [SESSION_HEADER]: token } : {}),
    ...(profileId ? { "x-profile-id": profileId } : {}),
  };
}

/**
 * Attach the session token to a **URL** rather than a header.
 *
 * ## Why this exists
 *
 * Two callers cannot use a header, and neither can be routed through the fetch
 * shim:
 *
 *  - `<audio src="...">` (streaming playback). A media element request is made
 *    by the browser, not by script, so there is nowhere to put a header. This
 *    is why playback failed with "playback could not start" while every
 *    `fetch()` in the app worked.
 *  - `Filesystem.downloadFile` (native download). The Capacitor plugin does
 *    accept headers, but the download also has to work through the plugin, and
 *    one mechanism for both is easier to reason about.
 *
 * The server accepts `?session=` as well as the header and the cookie; see the
 * auth gate in `server/src/app.ts`.
 *
 * Cost: a token in a URL can land in server access logs. That is a deliberate
 * trade for a household app on a trusted LAN -- the alternative is playback
 * that cannot authenticate at all. The token is an opaque random value that is
 * useless without the household password, and it is already sent in cleartext
 * over plain HTTP here, so the log is not a new place the secret can leak to.
 */
export function withSessionToken(url: string): string {
  const token = readSessionToken();
  if (!token) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}session=${encodeURIComponent(token)}`;
}

/**
 * URL for a book's cover art.
 *
 * Two things are easy to get wrong here, and both look identical in the UI --
 * every cover silently falls back to the placeholder:
 *
 * 1. It must go through `apiAssetUrl`. A bare `/api/audiobooks/N/cover` resolves
 *    against the WebView's `https://localhost` origin and returns the bundled
 *    `index.html`, which is not an image.
 * 2. It must carry the session token in the query string. An `<img src>`
 *    request is issued by the browser, not by script, so it cannot send the
 *    session header and never passes through the fetch shim -- exactly like
 *    `<audio src>`.
 *
 * Verified against the server: 11 of 12 books have a cover file on disk and the
 * endpoint returns 200 with image bytes, so a missing cover in the UI is a
 * client-side URL bug, not missing data.
 */
export function coverUrl(bookId: number): string {
  return withSessionToken(apiAssetUrl(`/api/audiobooks/${bookId}/cover`));
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
