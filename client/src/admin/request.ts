/**
 * The admin panel's request interface.
 *
 * The admin panel is a **separate application**: its own credential, its own
 * route table, its own bundle (ADR 022). It had sixteen raw `fetch` calls,
 * each spelling out `credentials: "include"` by hand, and a test file that
 * checked the build wiring and nothing else.
 *
 * This is the one way the panel talks to its own server. The guarantees:
 *
 *  1. **Bounded.** A request to a host that never answers gives up.
 *  2. **Credentialed.** The admin session cookie travels.
 *  3. **Its own vocabulary.** A failure throws an `AdminRequestError` that
 *     carries the server's code and status, so the panel can tell "not
 *     configured" from "wrong password" from "the server is down".
 *
 * ## Why it does not import the family client
 *
 * `lib/api.ts` carries the family's session handling, the listener's copy
 * catalogue and the private cache. The panel has no business with any of
 * them, and the panel's build must not drag them in: the two applications
 * are deliberately separate doors with separate credentials.
 *
 * The one rule the two share is the deadline, and it lives in
 * `lib/bounded.ts` -- a module with no application state in it, which both
 * bundles can import.
 */
import { fetchWithDeadline, REQUEST_TIMEOUT_MS } from "../lib/bounded";
import { copyAdmin } from "./copy";

/**
 * A failed admin request.
 *
 * It carries the machine code and the status, because the panel branches on
 * them: a sign-in that fails because the panel is not configured is a
 * different screen from a sign-in that fails because the password was wrong.
 */
export class AdminRequestError extends Error {
  /** The HTTP status, or 0 when the request never got an answer. */
  readonly status: number;
  /** The server's error code, or `null` when it did not send one. */
  readonly code: string | null;

  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.name = "AdminRequestError";
    this.status = status;
    this.code = code;
  }
}

/** How to shape an admin request. */
export interface AdminRequestOptions {
  /** The HTTP method. Defaults to `GET`. */
  method?: string;
  /** A JSON body. Serialised by the interface, so pass the object. */
  body?: object;
  /** Extra headers. */
  headers?: Record<string, string>;
  /** The deadline in milliseconds. Defaults to 30 seconds. */
  timeoutMs?: number;
}

/**
 * Make a request and read the JSON body.
 *
 * Throws an `AdminRequestError` when the server answers with a failure.
 */
export async function adminRequest<T>(
  path: string,
  options: AdminRequestOptions = {},
): Promise<T> {
  const response = await adminRequestRaw(path, options);
  if (!response.ok) {
    throw await failureFrom(response);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

/**
 * Make a request and hand back the response.
 *
 * For the callers that need the status -- the dashboard tells a 401 (sign
 * out) from any other failure -- and for the ones that treat a response as
 * data rather than as success or failure.
 *
 * A failure does **not** throw here. The caller decides what a failure means.
 */
export async function adminRequestRaw(
  path: string,
  options: AdminRequestOptions = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...options.headers };
  const hasBody = options.body !== undefined;
  if (hasBody) headers["Content-Type"] = "application/json";

  return fetchWithDeadline(
    path,
    {
      method: options.method ?? "GET",
      // The panel's session cookie lives on the admin origin.
      credentials: "include",
      ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
      headers,
    },
    options.timeoutMs ?? REQUEST_TIMEOUT_MS,
  );
}

/** Read a failed response and turn it into an `AdminRequestError`. */
async function failureFrom(response: Response): Promise<AdminRequestError> {
  let code: string | null = null;
  try {
    const body = (await response.json()) as { code?: unknown } | null;
    if (body && typeof body === "object" && typeof body.code === "string") {
      code = body.code;
    }
  } catch {
    // A body that is not JSON has no code. The status still does.
  }
  return new AdminRequestError(
    response.status,
    code,
    code ?? copyAdmin.shell.requestFailed,
  );
}
