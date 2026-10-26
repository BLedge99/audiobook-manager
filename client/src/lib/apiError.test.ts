import { describe, expect, it } from "vitest";
import { copy } from "../copy";
import { apiErrorText, responseErrorText } from "./apiError";

/**
 * The client half of the API error contract (ADR 015).
 *
 * The server sends a code; this module decides which reviewed sentence a
 * person reads. The cases that matter are the ones where there is no usable
 * code, because that is where a raw body could otherwise reach the screen. The
 * assertions read the catalog rather than repeating its words, so a wording
 * change is one edit -- `check:copy` is what guards the words themselves.
 */

describe("apiErrorText", () => {
  it("renders the catalog's sentence for a known code", () => {
    expect(apiErrorText(404, { code: "audiobook_not_found" })).toBe(copy.apiErrors.audiobookNotFound);
  });

  it("reads a code that belongs to an operator screen", () => {
    expect(apiErrorText(400, { code: "library_root_required" })).toBe(
      copy.operator.apiErrors.libraryRootRequired,
    );
  });

  it("maps the server's reason to its own sentence", () => {
    expect(apiErrorText(409, { code: "tag_name_rejected", params: { reason: "too-long" } })).toBe(
      copy.operator.apiErrors.tagNameRejected.tooLong,
    );
    expect(apiErrorText(409, { code: "tag_merge_failed", params: { reason: "same-tag" } })).toBe(
      copy.operator.apiErrors.tagMergeFailed.sameTag,
    );
  });

  it("still renders the sentence when a value is missing or unknown", () => {
    // A malformed params object must not throw in the error path, and an older
    // client must not show a reason code it has never heard of.
    expect(apiErrorText(409, { code: "tag_merge_failed" })).toBe(
      copy.operator.apiErrors.tagMergeFailedFallback,
    );
    expect(
      apiErrorText(409, { code: "tag_name_rejected", params: { reason: "a-newer-reason" } }),
    ).toBe(copy.operator.apiErrors.tagNameRejectedFallback);
  });

  it("uses the reviewed entry when the code already has one", () => {
    // The password, duplicate-profile and signed-out sentences are shown by
    // their own screens, so the API must not spell them a second time.
    expect(apiErrorText(401, { code: "incorrect_password" })).toBe(copy.login.wrongPassword);
    expect(apiErrorText(409, { code: "profile_name_taken" })).toBe(copy.profile.duplicate);
    expect(apiErrorText(401, { code: "auth_required" })).toBe(copy.profile.sessionExpired);
  });

  it("renders the spec 28 password and lockout sentences", () => {
    expect(apiErrorText(429, { code: "account_locked", params: { retryAfterSeconds: 30 } })).toBe(
      copy.login.locked(30),
    );
    expect(apiErrorText(400, { code: "password_too_short", params: { minLength: 8 } })).toBe(
      copy.login.passwordTooShort(8),
    );
    expect(apiErrorText(400, { code: "password_too_long", params: { maxLength: 128 } })).toBe(
      copy.login.passwordTooLong(128),
    );
    expect(apiErrorText(400, { code: "password_too_weak", params: { reason: "profile-name" } })).toBe(
      copy.login.passwordIsName,
    );
    expect(apiErrorText(400, { code: "password_too_weak", params: { reason: "common" } })).toBe(
      copy.login.passwordCommon,
    );
  });

  it("renders the spec 28 account, passkey and device sentences", () => {
    expect(apiErrorText(409, { code: "profile_unclaimed" })).toBe(copy.login.profileUnclaimed);
    expect(apiErrorText(403, { code: "account_disabled" })).toBe(copy.login.accountDisabled);
    expect(apiErrorText(409, { code: "claim_unavailable" })).toBe(copy.login.claimUnavailable);
    expect(apiErrorText(503, { code: "passkey_not_configured" })).toBe(copy.login.passkeyUnavailable);
    expect(apiErrorText(401, { code: "passkey_failed" })).toBe(copy.login.passkeyFailed);
    expect(apiErrorText(404, { code: "passkey_not_found" })).toBe(copy.login.passkeyGone);
    expect(apiErrorText(404, { code: "device_not_found" })).toBe(copy.login.deviceGone);
    expect(apiErrorText(401, { code: "device_auth_failed" })).toBe(copy.login.deviceFailed);
  });

  it("falls back to the generic sentence for an unknown code", () => {
    expect(apiErrorText(418, { code: "not_a_shipped_code" })).toBe(copy.errors.requestFailed(418));
  });

  it("falls back to the generic sentence when there is no code", () => {
    expect(apiErrorText(500, { message: "leaked prose" })).toBe(copy.errors.requestFailed(500));
    expect(apiErrorText(500, "plain text")).toBe(copy.errors.requestFailed(500));
    expect(apiErrorText(500, null)).toBe(copy.errors.requestFailed(500));
  });
});

describe("responseErrorText", () => {
  it("reads the code out of a JSON body", async () => {
    const response = new Response(JSON.stringify({ code: "forbidden" }), { status: 403 });
    await expect(responseErrorText(response)).resolves.toBe(copy.apiErrors.forbidden);
  });

  it("uses the generic sentence when the body is not JSON", async () => {
    const response = new Response("<html>bad gateway</html>", { status: 502 });
    await expect(responseErrorText(response)).resolves.toBe(copy.errors.requestFailed(502));
  });
});
