/**
 * Shared helpers for stubbing HTTP requests in client tests.
 *
 * ## Why this exists
 *
 * Three test files each wrote their own `fakeResponse`, and they disagreed:
 * one knew about ETags, two did not. Each wrote its own
 * `vi.stubGlobal("fetch", ...)`, and none of them recorded what was actually
 * requested -- so a test could answer a request but never assert on it.
 *
 * The app makes requests through several different paths (the request
 * interface, the reachability probe, the cover fetcher), and a test that
 * cannot see the request cannot tell those apart. These helpers give every
 * test the same way to answer a request and the same way to see it.
 *
 * ## The rules
 *
 * - `fakeResponse` is a **response**, not a promise. It answers what a `fetch`
 *   would answer, so the code under test sees the same shape it sees in
 *   production.
 * - `stubFetch` **records** every request. The recorded calls are the
 *   assertion surface.
 * - `restore` puts the real `fetch` back. Call it in an `afterEach`, or let
 *   Vitest's `unstubAllGlobals` do it -- `restore` is idempotent either way.
 */
import { vi } from "vitest";

/** One request the stub saw. */
export interface RecordedRequest {
  /** The URL, as the caller passed it. */
  url: string;
  /** The HTTP method, upper-cased. Defaults to `GET`. */
  method: string;
  /** The headers, lower-cased keys. */
  headers: Record<string, string>;
  /** The request body, as a string, or `undefined` when there was none. */
  body?: string;
  /**
   * The credentials mode the caller asked for.
   *
   * Recorded because it is the difference between a request that carries the
   * session cookie across origins and one that silently does not -- and the
   * Android WebView is cross-origin from the server.
   */
  credentials?: RequestCredentials;
}

/** What `stubFetch` hands back. */
export interface FetchStub {
  /** Every request the stub saw, in order. */
  calls: RecordedRequest[];
  /** The most recent request, or `undefined` if there was none. */
  last(): RecordedRequest | undefined;
  /** The requests whose URL contains `fragment`. */
  to(fragment: string): RecordedRequest[];
  /** Put the real `fetch` back. Safe to call more than once. */
  restore(): void;
}

/** How to shape a fake response. */
export interface FakeResponseInit {
  /** The status code. Defaults to 200. */
  status?: number;
  /**
   * The `ETag` header value, or `null` for "no tag".
   *
   * `undefined` and `null` are the same here on purpose: a test that does not
   * care about ETags should not have to say so twice.
   */
  etag?: string | null;
}

/**
 * A `Response` stand-in.
 *
 * The real `Response` body can only be read once. This one answers every
 * time, because a test that reads the body twice to assert two things is not
 * testing anything the app does -- the app reads a body once.
 */
export function fakeResponse(body: unknown, init: FakeResponseInit = {}): Response {
  const status = init.status ?? 200;
  const etag = init.etag ?? null;
  const serialised = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === "etag" ? etag : null),
    },
    json: async () => body,
    text: async () => serialised,
  } as unknown as Response;
}

/** A handler that answers a request. */
export type FetchHandler = (
  url: string,
  init?: RequestInit,
) => Response | Promise<Response>;

/**
 * Race a handler's answer against the caller's abort signal.
 *
 * A real `fetch` rejects with an `AbortError` when its signal fires, even
 * though the network request is still in flight. A stub that ignored the
 * signal would make every deadline untestable -- and the deadline is the whole
 * point of the bounded fetch.
 */
function respondToSignal(
  init: RequestInit | undefined,
  answer: Response | Promise<Response>,
): Promise<Response> {
  const signal = init?.signal;
  if (!signal) return Promise.resolve(answer);

  if (signal.aborted) return Promise.reject(abortError());

  return new Promise<Response>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(answer).then(
      (response) => {
        signal.removeEventListener("abort", onAbort);
        resolve(response);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/** The error a real `fetch` rejects with when its signal fires. */
function abortError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException("The operation was aborted.", "AbortError");
  }
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

/**
 * Install a `fetch` stub that records what it was asked for.
 *
 * ```ts
 * const stub = stubFetch((url) => fakeResponse(url.includes("/api/tags") ? [] : {}));
 * try {
 *   await fetch("/api/tags");
 *   expect(stub.to("/api/tags")).toHaveLength(1);
 * } finally {
 *   stub.restore();
 * }
 * ```
 */
export function stubFetch(handler: FetchHandler): FetchStub {
  const calls: RecordedRequest[] = [];

  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {};
    const raw = init?.headers;
    if (raw) {
      if (raw instanceof Headers) {
        raw.forEach((value, key) => {
          headers[key.toLowerCase()] = value;
        });
      } else if (Array.isArray(raw)) {
        for (const [key, value] of raw) headers[key.toLowerCase()] = value;
      } else {
        for (const [key, value] of Object.entries(raw)) headers[key.toLowerCase()] = String(value);
      }
    }
    calls.push({
      url,
      method,
      headers,
      body: typeof init?.body === "string" ? init.body : undefined,
      credentials: init?.credentials,
    });
    return respondToSignal(init, handler(url, init));
  };

  vi.stubGlobal("fetch", impl);

  let restored = false;
  return {
    calls,
    last: () => calls[calls.length - 1],
    to: (fragment: string) => calls.filter((call) => call.url.includes(fragment)),
    restore: () => {
      if (restored) return;
      restored = true;
      vi.unstubAllGlobals();
    },
  };
}
