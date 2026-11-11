import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ProfileSwitcher } from "./ProfileSwitcher";
import { copy } from "../copy";
import { stubFetch, type FetchStub } from "../test/requests";

/**
 * The profile switcher.
 *
 * It has no test file of its own, and it is the one component whose requests
 * were completely unguarded: `load()` had no `try/catch` and no timeout, so a
 * rejected fetch became an unhandled rejection and the component showed
 * nothing at all. A listener whose phone had lost the network was left with
 * an empty dropdown and no explanation.
 */

let stub: FetchStub | null = null;

/** The session probe and the profile list. */
function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

beforeEach(() => {
  window.localStorage.clear();
  stub = stubFetch((url) =>
    url.includes("/api/auth/session") ? ok({ via: "profile" }) : ok([]),
  );
});

afterEach(() => {
  stub?.restore();
  stub = null;
  vi.unstubAllGlobals();
});

describe("ProfileSwitcher", () => {
  it("shows an error when the profiles cannot be loaded", async () => {
    // The bug: `load()` had no error handling, so the failure was an
    // unhandled rejection and the dropdown was silently empty.
    stub?.restore();
    stub = stubFetch(() => {
      throw new Error("Failed to fetch");
    });

    render(<ProfileSwitcher />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent(copy.errors.cannotReachServer);
  });

  it("asks for credentials, so the session cookie travels", async () => {
    render(<ProfileSwitcher />);

    await waitFor(() => expect(stub?.calls.length).toBeGreaterThan(0));
    expect(stub?.calls.every((call) => call.credentials === "include")).toBe(true);
  });

  it("lists the profiles the server returns", async () => {
    stub?.restore();
    stub = stubFetch((url) =>
      url.includes("/api/auth/session")
        ? ok({ via: "profile" })
        : ok([{ id: 3, name: "Arthur" }]),
    );

    render(<ProfileSwitcher />);

    await waitFor(() => expect(screen.getByRole("option", { name: "Arthur" })).toBeInTheDocument());
  });
});
