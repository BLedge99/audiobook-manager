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
 * | Android | `http://your-server:3000` | `http://your-server:3000/api/audiobooks` |
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
import { mediaProxyUrl } from "./mediaProxy";
import { copy } from "../copy";
import { responseErrorText } from "./apiError";
import { fetchWithDeadline, REQUEST_TIMEOUT_MS } from "./bounded";
import { isOfflineMode } from "./offlineMode";

export const SERVER_URL_KEY = "serverUrl";

import { lockOfflineCache } from "../local/privateCache";

/** Legacy key removed on sign-in; session tokens are no longer persisted. */
export const SESSION_TOKEN_KEY = "houseSessionToken";

// Remove the bearer token persisted by pre-spec-28 clients. Browsers now use
// only the HttpOnly cookie; Android sessions are memory-only and renewed from
// the biometric Vault or password after a process restart.
if (typeof window !== "undefined") {
  try { window.localStorage.removeItem(SESSION_TOKEN_KEY); } catch { /* ignored */ }
}

/** Storage key for the profile chosen in the break-glass flow. */
export const PROFILE_ID_KEY = "profileId";
let nativeSessionToken = "";
/** The header the server accepts the session token in (see server `app.ts`). */
export const SESSION_HEADER = "x-house-session";
let accountExperience: "household" | "demo" = "household";
const OFFLINE_MODE_ERROR = "The app is in offline mode.";

export interface SessionProfile {
  id?: number;
  name?: string;
  email?: string | null;
  color?: string | null;
  role?: "admin" | "member";
}

export interface SessionInfo {
  authDisabled: boolean;
  profile: SessionProfile | null;
  role: "admin" | "member";
  via: "profile" | "household" | "device" | "oauth";
  expiresAt: string | null;
  capabilities: {
    passkeys: boolean;
    devices: boolean;
  };
}

export interface AppConfig {
  accountExperience: "household" | "demo";
  oauthProviders?: string[];
}

export function setAccountExperience(experience: "household" | "demo"): void {
  accountExperience = experience;
}

export async function fetchAppConfig(): Promise<AppConfig> {
  try {
    const response = await boundedFetch("/api/config");
    if (!response.ok) return { accountExperience: "household", oauthProviders: [] };
    const config = (await response.json()) as Partial<AppConfig>;
    return {
      accountExperience: config.accountExperience === "demo" ? "demo" : "household",
      oauthProviders: Array.isArray(config.oauthProviders) ? config.oauthProviders : [],
    };
  } catch {
    return { accountExperience: "household", oauthProviders: [] };
  }
}

/**
 * Keep the session token returned by `/api/auth/login`.
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
 * login response body and sent as a header by Android. The browser relies on
 * the HttpOnly cookie; Android keeps its token in memory and stores the
 * long-lived device secret only in the native biometric Vault.
 */
export function setSessionToken(token: string | undefined | null): void {
  if (typeof window === "undefined") return;
  nativeSessionToken = isNativeShell() ? token || "" : "";
  try {
    // Remove tokens left by versions that stored them in localStorage.
    window.localStorage.removeItem(SESSION_TOKEN_KEY);
  } catch {
    // Private mode / storage disabled. The browser cookie path still works.
  }
}

/** The profile id stored for the break-glass flow (and offline fallback). */
export function getActiveProfileId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(PROFILE_ID_KEY);
  } catch {
    return null;
  }
}

/**
 * The active profile id as a positive integer, or null when unset or
 * unparseable. Numeric call sites used to repeat `Number(...)` plus the
 * `Number.isInteger(...) && > 0` guard at each read.
 */
export function getActiveProfileIdNumber(): number | null {
  const raw = getActiveProfileId();
  if (!raw) return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function setActiveProfileId(id: string | number | null): void {
  if (typeof window === "undefined") return;
  try {
    if (id === null) window.localStorage.removeItem(PROFILE_ID_KEY);
    else window.localStorage.setItem(PROFILE_ID_KEY, String(id));
  } catch {
    // Private mode / storage disabled.
  }
}

/**
 * The pending-profile marker: the profile the switcher wants after a reload
 * drops the session. The picker consumes it to open the right password form.
 * One accessor set, one key -- every caller used to carry its own copy of
 * the constant.
 */
const PENDING_PROFILE_KEY = "pendingProfileId";

export function getPendingProfileId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(PENDING_PROFILE_KEY);
  } catch {
    return null;
  }
}

export function setPendingProfileId(id: string | number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PENDING_PROFILE_KEY, String(id));
  } catch {
    // Private mode / storage disabled.
  }
}

export function clearPendingProfileId(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PENDING_PROFILE_KEY);
  } catch {
    // Private mode / storage disabled.
  }
}

/**
 * Ask the server who this session is (spec 28).
 *
 * Returns `null` for a 401 or a network failure rather than throwing: the boot
 * path uses this to decide between the account picker, the break-glass profile
 * gate and the signed-in app, and a throw there means a blank screen.
 */
export async function fetchSession(): Promise<SessionInfo | null> {
  try {
    const res = await boundedFetch("/api/auth/session");
    if (!res.ok) return null;
    return (await res.json()) as SessionInfo;
  } catch {
    return null;
  }
}

/**
 * Revoke the current session and forget the local token.
 *
 * Used by "Lock" and by profile switching. The server revoke is best-effort:
 * an offline browser still has to drop the token locally, and the stale cookie
 * is revoked on the next contact.
 */
export async function lockSession(): Promise<void> {
  try {
    await boundedFetch("/api/auth/logout", { method: "POST" });
  } catch {
    // Offline: local lock is still authoritative.
  }
  setSessionToken(null);
  // A lock also clears the in-memory DEK. Without this, hiding the account
  // picker over the still-rendered app would leave decrypted rows in reach.
  lockOfflineCache();
}

/**
 * Local-only lock: forget the in-memory session token and clear the offline
 * DEK, without revoking anything server-side.
 *
 * Used by the background lock. That is a *local* privacy action -- clear the
 * keys the app holds in memory -- and must not also sign the listener out of
 * the app. Revoking the server session from a timer, or flipping the app into
 * a signed-out state, turned a privacy behaviour into a "random logout on a
 * timeout" for anyone who happened to leave an audiobook playing with the
 * screen off.
 */
export async function lockLocal(): Promise<void> {
  setSessionToken(null);
  // A lock also clears the in-memory DEK. Without this, hiding the account
  // picker over the still-rendered app would leave decrypted rows in reach.
  lockOfflineCache();
}

function readSessionToken(): string {
  return isNativeShell() ? nativeSessionToken : "";
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
 * the realistic typo is `your-server:3000` with no `http://`, and rejecting
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
 * `fetch("http://your-server:3000/api/x")` into
 * `http://your-server:3000/http://your-server:3000/api/x`. Anything with a
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

/**
 * Did this failure mean the server could not be reached?
 *
 * Two shapes count, and they are the two the app actually sees:
 *
 *  - the browser's own "Failed to fetch" (a `TypeError`), which means the
 *    request never got an answer at all;
 *  - an `AbortError`, which is the app's own deadline firing. A request to an
 *    unreachable host does not always fail -- it *hangs* (see
 *    `lib/reachability.ts`), so the timeout is the same problem wearing a
 *    different hat.
 *
 * Anything else is the server answering with an error, which is a different
 * problem with a different fix and should keep the server's own message.
 */
const NETWORK_FAILURE_PHRASES = [
  "failed to fetch",
  "network error",
  "networkerror",
  "network request failed",
  "load failed",
];

export function isNetworkFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: string; message?: string };
  // The app's own deadline. A request to an unreachable host does not always
  // fail -- it hangs -- so the timeout is the same problem wearing a
  // different hat.
  if (candidate.name === "AbortError" || candidate.name === "NetworkError") return true;
  if (typeof candidate.message !== "string") return false;
  const message = candidate.message.toLowerCase();
  return NETWORK_FAILURE_PHRASES.some((phrase) => message.includes(phrase));
}

/**
 * The message a listener gets for a failed request.
 *
 * A network failure becomes a sentence with a next step. Everything else
 * keeps the server's own message, which is the useful one when the server
 * answered and said why.
 *
 * The browser's own answer -- "Failed to fetch" -- is not a message anybody
 * outside a browser console has ever heard, and it says nothing about what to
 * do. The household was shown it, more than once, and it told them nothing.
 */
export function describeFailure(error: unknown, fallback: string): string {
  if (isNetworkFailure(error)) return copy.errors.cannotReachServer;
  return error instanceof Error ? error.message : fallback;
}

/* -------------------------------------------------------------------------- */
/* "The server stopped answering"                                             */
/* -------------------------------------------------------------------------- */

type UnreachableListener = () => void;

const unreachableListeners = new Set<UnreachableListener>();

/**
 * Be told when a request fails because the server could not be reached.
 *
 * ## Why this exists
 *
 * The app knows the server is unreachable only because a **probe** said so,
 * and the probe only ran at startup and when the window regained focus. So a
 * phone that was unplugged from the network -- or pointed at the wrong address
 * -- went on showing the shelf it had loaded, with buttons that looked alive
 * and silently did nothing. The household's report was exactly this: they
 * took books out of their library, the books stayed, and pressing refresh did
 * nothing.
 *
 * A failed request is the same fact, noticed sooner. So every request that
 * cannot be answered reports it here, and the app re-probes: the probe is
 * authoritative, so a single blip does not take the app offline.
 */
export function onServerUnreachable(listener: UnreachableListener): () => void {
  unreachableListeners.add(listener);
  return () => {
    unreachableListeners.delete(listener);
  };
}

function reportServerUnreachable() {
  for (const listener of unreachableListeners) {
    try {
      listener();
    } catch {
      // A listener must never break the request that reported the failure.
    }
  }
}

/** The profile header the server scopes progress and favourites by. */
export function profileHeaders(): Record<string, string> {
  const profileId = getActiveProfileId();
  return profileId && accountExperience !== "demo" ? { "x-profile-id": profileId } : {};
}

/**
 * A fetch that always finishes, and that is correct on its own.
 *
 * ## Why the deadline exists
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
 * The deadline itself lives in `lib/bounded.ts`, because the admin panel needs
 * it too and must not import this module.
 *
 * ## Why the request owns its own guarantees
 *
 * This used to rely on a global `window.fetch` patch, installed in
 * `main.tsx`, to resolve the base URL, attach the session token and set the
 * credentials. That made a request correct only because something else had
 * run first — a property of the environment rather than of the call. A module
 * that used `boundedFetch` was right by accident.
 *
 * So the guarantees live here, and the request is correct whether or not
 * anything has been installed. There is no global patch: the two call sites
 * that cannot use this -- the signed-URL upload in the admin client and the
 * local cover cache, which must not carry the session header to a media URL --
 * make their raw `fetch` on their own terms.
 */
export { REQUEST_TIMEOUT_MS } from "./bounded";

export async function boundedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  if (isOfflineMode()) {
    throw new Error(OFFLINE_MODE_ERROR);
  }

  // The session header, for the native shell. The browser relies on the
  // HttpOnly cookie and has no token to send.
  const token = isNativeShell() ? readSessionToken() : "";
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  if (token && !hasHeader(headers, SESSION_HEADER)) headers[SESSION_HEADER] = token;

  try {
    return await fetchWithDeadline(
      resolveApiRequest(input),
      {
        ...init,
        headers: token ? headers : init.headers,
        // The session cookie only crosses origins when the client opts in with
        // `credentials: "include"`. Without it every cross-origin call -- which is
        // every call from the Android shell's https://localhost WebView -- gets no
        // cookie and so 401s even though the user "logged in".
        credentials: "include",
      },
      timeoutMs,
    );
  } catch (requestError) {
    // Every request the app makes flows through here, which makes it the one
    // place that can notice the server has stopped answering -- and the
    // probe authoritative on whether that is a blip or the end of the
    // connection.
    if (isNetworkFailure(requestError)) reportServerUnreachable();
    throw requestError;
  }
}

/**
 * Headers for a native plugin request that bypasses fetch.
 *
 * These bypass the `fetch` shim, so the in-memory native session must be
 * attached explicitly. Browser requests rely on their HttpOnly cookie.
 */
export function sessionHeaders(): Record<string, string> {
  const token = isNativeShell() ? readSessionToken() : "";
  const profileId = getActiveProfileId();
  return {
    ...(token ? { [SESSION_HEADER]: token } : {}),
    ...(profileId && accountExperience !== "demo" ? { "x-profile-id": profileId } : {}),
  };
}

export type MediaResourceKind = "cover" | "book-stream" | "track-stream";

/**
 * Native media requests cannot attach the session header consistently. Give
 * them a five-minute token bound to the signed-in profile and one media item.
 * Browsers use the same-origin HttpOnly cookie and never put a session token in
 * a URL.
 */
export async function mediaAssetUrl(path: string, kind: MediaResourceKind, id: number): Promise<string> {
  const url = apiUrl(path);
  if (!isNativeShell() || !readSessionToken()) return url;
  // The server scopes the token to the active profile, resolved from
  // `x-profile-id` — the session token alone does not carry a profile for
  // household sign-ins, so the mint 400s without it. Production never
  // noticed: plain stream URLs work over https.
  const response = await boundedFetch(apiUrl("/api/auth/media-token"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...profileHeaders() },
    body: JSON.stringify({ kind, id }),
  });
  if (!response.ok) throw new Error(await responseErrorText(response));
  const result = await response.json() as { token?: string | null };
  if (!result.token) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}media=${encodeURIComponent(result.token)}`;
}

/**
 * URL for a book's cover art.
 *
 * Two things are easy to get wrong here, and both look identical in the UI --
 * every cover silently falls back to the placeholder:
 *
 * 1. It must be resolved against the configured server. A bare
 *    `/api/audiobooks/N/cover` resolves against the WebView's `https://localhost`
 *    origin and returns the bundled `index.html`, which is not an image.
 * 2. A native request gets a short-lived resource token; the web uses its
 *    same-origin HttpOnly cookie. In the shell the resolved URL is rewritten
 *    to the app-origin media proxy (see lib/mediaProxy.ts): an absolute
 *    http(s) `<img>` src is auto-upgraded to https by Chrome and blocked,
 *    and the proxy keeps the image on the app origin like the media element.
 *
 * Verified against the server: 11 of 12 books have a cover file on disk and the
 * endpoint returns 200 with image bytes, so a missing cover in the UI is a
 * client-side URL bug, not missing data.
 */
export async function coverUrl(bookId: number): Promise<string> {
  const url = await mediaAssetUrl(`/api/audiobooks/${bookId}/cover`, "cover", bookId);
  return isNativeShell() ? mediaProxyUrl(url) : url;
}


