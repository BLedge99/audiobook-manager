import { copy } from "../copy";

/**
 * Turns a failed API response into the sentence a person reads (ADR 015).
 *
 * The server answers a failure with a stable code and, when the sentence needs
 * a value, `params`. Every word lives in `copy.apiErrors`, so there is one
 * catalog and `npm run check:copy` sees the lot.
 *
 * ## Why the fallback is not "show what the server sent"
 *
 * A missing, unknown or non-JSON code has no reviewed sentence. Rendering the
 * body would put a proxy's HTML error page, or a future server's unreviewed
 * prose, in front of a listener -- the exact leak this contract closes. The
 * generic sentence names the failure and the next step, and names the status
 * code only as a secondary detail. An older client therefore also survives a
 * newer server adding a code: it degrades to the generic sentence, never to
 * `undefined`.
 */
export function apiErrorText(status: number, body: unknown): string {
  if (!body || typeof body !== "object") return copy.errors.requestFailed(status);

  const { code, params } = body as { code?: unknown; params?: unknown };
  if (typeof code !== "string") return copy.errors.requestFailed(status);

  const alias = ALIASES[code];
  if (alias) return alias();

  const entry = (copy.apiErrors as Record<string, unknown>)[catalogKey(code)];
  if (typeof entry === "string") return entry;
  if (typeof entry === "function") {
    const reason = (params as { reason?: unknown } | undefined)?.reason;
    return (entry as (value: string) => string)(typeof reason === "string" ? reason : "");
  }
  return copy.errors.requestFailed(status);
}

/**
 * Codes whose sentence already has a reviewed entry elsewhere in the catalog.
 *
 * A second copy would be the drift `copy.ts` exists to prevent, and the copy
 * checker would rightly flag the new one. The password line is the one the
 * login screen shows, so both must come from the same key.
 */
const ALIASES: Record<string, () => string> = {
  incorrect_password: () => copy.login.wrongPassword,
  profile_name_taken: () => copy.profile.duplicate,
};

/**
 * Read a failed response and resolve its sentence. Never throws.
 *
 * Consumes the body, so call it in place of `response.text()` -- it is the one
 * place that knows the error shape.
 */
export async function responseErrorText(response: Response): Promise<string> {
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return copy.errors.requestFailed(response.status);
  }
  return apiErrorText(response.status, body);
}

/** `audiobook_not_found` -> `audiobookNotFound`, the shape of the catalog keys. */
function catalogKey(code: string): string {
  return code.replace(/_([a-z])/g, (_separator, letter: string) => letter.toUpperCase());
}
