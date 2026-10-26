import { copy } from "../copy";

/**
 * Turns a failed API response into the sentence a person reads (ADR 015).
 *
 * The server answers a failure with a stable code and, when the sentence needs
 * a value, `params`. Every word lives in the catalog: `copy.apiErrors` for the
 * codes a listener can meet, `copy.operator.apiErrors` for the ones only an
 * operator screen can raise. The split is deliberate -- the operator sentences
 * name folders, scans and tags, and those words are banned from the listener
 * tier -- so a code is written for exactly one audience.
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

  // Codes whose sentence needs a value or a reason (spec 28). Keeping them here
  // rather than in `copy.apiErrors` is deliberate: that table is a flat
  // code-to-string map, while these sentences are functions.
  switch (code) {
    case "account_locked":
      return copy.login.locked(numberParam(params, "retryAfterSeconds") ?? 60);
    case "password_too_short":
      return copy.login.passwordTooShort(numberParam(params, "minLength") ?? 8);
    case "password_too_long":
      return copy.login.passwordTooLong(numberParam(params, "maxLength") ?? 128);
    case "password_too_weak":
      return stringParam(params, "reason") === "profile-name"
        ? copy.login.passwordIsName
        : copy.login.passwordCommon;
    case "profile_unclaimed":
      return copy.login.profileUnclaimed;
    case "account_disabled":
      return copy.login.accountDisabled;
    case "claim_unavailable":
      return copy.login.claimUnavailable;
    case "passkey_not_configured":
      return copy.login.passkeyUnavailable;
    case "passkey_failed":
      return copy.login.passkeyFailed;
    case "passkey_not_found":
      return copy.login.passkeyGone;
    case "session_not_found":
    case "device_not_found":
      return copy.login.deviceGone;
    case "device_auth_failed":
      return copy.login.deviceFailed;
  }

  const key = catalogKey(code);
  const listener = (copy.apiErrors as Record<string, unknown>)[key];
  if (typeof listener === "string") return listener;

  const operator = (copy.operator.apiErrors as Record<string, unknown>)[key];
  if (typeof operator === "string") return operator;

  // Two operator codes carry a machine code in `params.reason` rather than a
  // value to splice. Each reason has its own sentence, with a fallback so an
  // unknown reason never reaches the screen raw.
  if (code === "tag_name_rejected") {
    return (
      reasonEntry(copy.operator.apiErrors.tagNameRejected, params) ??
      copy.operator.apiErrors.tagNameRejectedFallback
    );
  }
  if (code === "tag_merge_failed") {
    return (
      reasonEntry(copy.operator.apiErrors.tagMergeFailed, params) ??
      copy.operator.apiErrors.tagMergeFailedFallback
    );
  }

  return copy.errors.requestFailed(status);
}

/**
 * Codes whose sentence already has a reviewed entry elsewhere in the catalog.
 *
 * A second copy would be the drift `copy.ts` exists to prevent, and the copy
 * checker would rightly flag the new one. The password line is the one the
 * login screen shows, so both must come from the same key; the same is true of
 * the duplicate-profile line and the signed-out line.
 */
const ALIASES: Record<string, () => string> = {
  incorrect_password: () => copy.login.wrongPassword,
  profile_name_taken: () => copy.profile.duplicate,
  auth_required: () => copy.profile.sessionExpired,
};

/** Look up a reason-keyed sentence, or `undefined` when the reason is unknown. */
function reasonEntry(table: Record<string, string>, params: unknown): string | undefined {
  const reason = (params as { reason?: unknown } | undefined)?.reason;
  if (typeof reason !== "string") return undefined;
  return table[catalogKey(reason)];
}

function numberParam(params: unknown, key: string): number | undefined {
  const value = (params as Record<string, unknown> | undefined)?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringParam(params: unknown, key: string): string | undefined {
  const value = (params as Record<string, unknown> | undefined)?.[key];
  return typeof value === "string" ? value : undefined;
}

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

/**
 * `audiobook_not_found` -> `audiobookNotFound`, the shape of the catalog keys.
 *
 * Server error codes use underscores; tag reasons use hyphens. Both collapse to
 * camelCase, so either shape finds its entry.
 */
function catalogKey(code: string): string {
  return code.replace(/[_-]([a-z])/g, (_separator, letter: string) => letter.toUpperCase());
}
