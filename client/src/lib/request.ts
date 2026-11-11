/**
 * The one way the app talks to its own server.
 *
 * ## Why this exists
 *
 * The app used to have eight near-identical private `request` helpers --
 * one each in `useLibrary`, `useBrowse`, `ReviewQueue`, `TagManager` and
 * others -- plus raw `fetch` calls in six components, plus a global
 * `window.fetch` monkey-patch in `main.tsx` that attached credentials and
 * the session token.
 *
 * That arrangement had one serious property: **the safety of a request
 * depended on a global side effect** rather than on the call site. A helper
 * that forgot `credentials: "include"` sent no cookie; a helper that forgot
 * the timeout hung for ever; `ProfileSwitcher` had neither, so a failed
 * profile load threw an unhandled rejection and the component showed
 * nothing.
 *
 * So the guarantees live here, once:
 *
 *  1. **Bounded.** A request to a host that never answers gives up. A fetch
 *     to an unreachable host does not always fail -- it *hangs*, because a
 *     stale DHCP address on a blackholing network never sends a RST.
 *  2. **Authenticated.** The session cookie travels (`credentials:
 *     "include"`), because the Android WebView is cross-origin from the
 *     server. In the native shell the session header is attached too.
 *  3. **Profile-scoped.** `x-profile-id` says whose data is being asked for.
 *  4. **One error vocabulary.** A failure throws the reviewed sentence for
 *     the server's error code (ADR 015), never the server's prose.
 *  5. **Offline-aware.** In explicit offline mode the request refuses
 *     instead of hanging.
 *
 * The interface is deliberately small: a path, and a handful of options.
 * Everything else is a composition of things that already existed.
 */
import { apiUrl, boundedFetch, REQUEST_TIMEOUT_MS, sessionHeaders } from "./api";
import { responseErrorText } from "./apiError";

/** How to shape a request. */
export interface RequestOptions {
  /** The HTTP method. Defaults to `GET`. */
  method?: string;
  /** A JSON body. Sent with `Content-Type: application/json`. */
  body?: unknown;
  /** Extra headers. Merged over the standard ones. */
  headers?: Record<string, string>;
  /** An external signal, composed with the timeout rather than replacing it. */
  signal?: AbortSignal;
  /** The deadline in milliseconds. Defaults to 30 seconds. */
  timeoutMs?: number;
  /**
   * Keep the request alive past the page unloading.
   *
   * The progress saver needs this: the browser cancels in-flight requests on
   * navigation, and the final save is exactly the case where the app is being
   * closed.
   */
  keepalive?: boolean;
}

/**
 * Make a request and read the JSON body.
 *
 * Throws with the reviewed sentence when the server answers with a failure.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await requestRaw(path, options);
  if (!response.ok) {
    throw new Error(await responseErrorText(response));
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

/**
 * Make a request and hand back the response.
 *
 * For the callers that need the headers -- the library listing reads the
 * `ETag`, the cover route streams the body -- and for the ones that treat a
 * `304` as "nothing changed" rather than as a failure.
 *
 * A failure does **not** throw here. The caller decides what a failure means.
 */
export async function requestRaw(path: string, options: RequestOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {
    ...sessionHeaders(),
    ...options.headers,
  };
  const hasBody = options.body !== undefined;
  if (hasBody) headers["Content-Type"] = "application/json";

  return boundedFetch(
    apiUrl(path),
    {
      method: options.method ?? "GET",
      credentials: "include",
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.keepalive ? { keepalive: true } : {}),
      ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
      headers,
    },
    options.timeoutMs ?? REQUEST_TIMEOUT_MS,
  );
}
