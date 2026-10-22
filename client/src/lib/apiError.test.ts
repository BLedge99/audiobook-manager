import { describe, expect, it } from "vitest";
import { copy } from "../copy";
import { apiErrorText, responseErrorText } from "./apiError";

/**
 * The client half of the API error contract (ADR 015).
 *
 * The server sends a code; this module decides which reviewed sentence a
 * person reads. The cases that matter are the ones where there is no usable
 * code, because that is where a raw body could otherwise reach the screen.
 */

describe("apiErrorText", () => {
  it("renders the catalog's sentence for a known code", () => {
    expect(apiErrorText(404, { code: "audiobook_not_found" })).toBe("Audiobook not found");
  });

  it("passes params to a message with a value", () => {
    expect(apiErrorText(409, { code: "tag_name_rejected", params: { reason: "too-long" } })).toBe(
      "Tag name rejected: too-long",
    );
  });

  it("still renders the sentence when a value is missing", () => {
    // A malformed params object must not throw in the error path.
    expect(apiErrorText(409, { code: "tag_merge_failed" })).toBe("Merge failed: ");
  });

  it("uses the reviewed entry when the code already has one", () => {
    // The password and duplicate-profile sentences are shown by their own
    // screens, so the API must not spell them a second time.
    expect(apiErrorText(401, { code: "incorrect_password" })).toBe(copy.login.wrongPassword);
    expect(apiErrorText(409, { code: "profile_name_taken" })).toBe(copy.profile.duplicate);
  });

  it("falls back to the generic sentence for an unknown code", () => {
    expect(apiErrorText(418, { code: "not_a_shipped_code" })).toBe("Something went wrong (HTTP 418). Try again.");
  });

  it("falls back to the generic sentence when there is no code", () => {
    expect(apiErrorText(500, { message: "leaked prose" })).toBe("Something went wrong (HTTP 500). Try again.");
    expect(apiErrorText(500, "plain text")).toBe("Something went wrong (HTTP 500). Try again.");
    expect(apiErrorText(500, null)).toBe("Something went wrong (HTTP 500). Try again.");
  });
});

describe("responseErrorText", () => {
  it("reads the code out of a JSON body", async () => {
    const response = new Response(JSON.stringify({ code: "forbidden" }), { status: 403 });
    await expect(responseErrorText(response)).resolves.toBe("Forbidden");
  });

  it("uses the generic sentence when the body is not JSON", async () => {
    const response = new Response("<html>bad gateway</html>", { status: 502 });
    await expect(responseErrorText(response)).resolves.toBe("Something went wrong (HTTP 502). Try again.");
  });
});
