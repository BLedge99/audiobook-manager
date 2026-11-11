import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { copyAdmin } from "./copy";
import { adminRequest, adminRequestRaw, AdminRequestError } from "./request";
import { fakeResponse, stubFetch, type FetchStub } from "../test/requests";

/**
 * The admin panel's request interface.
 *
 * The admin panel is a **separate application** with its own credential, its
 * own route table and its own bundle (ADR 022). It has sixteen raw `fetch`
 * calls today, each one spelling out `credentials: "include"` by hand.
 *
 * It must not import the family's `lib/api.ts`: that module carries the
 * family session handling, the listener's copy catalogue and the private
 * cache, and the panel's build has no business with any of them.
 */

let stub: FetchStub | null = null;

beforeEach(() => {
  stub = stubFetch(() => fakeResponse({}));
});

afterEach(() => {
  stub?.restore();
  stub = null;
  vi.unstubAllGlobals();
});

describe("adminRequest", () => {
  it("gives up on a server that never answers", async () => {
    stub?.restore();
    stub = stubFetch(() => new Promise<Response>(() => {}));

    await expect(adminRequest("/api/admin/status", { timeoutMs: 20 })).rejects.toThrow();
  });

  it("asks for credentials, so the admin session cookie travels", async () => {
    await adminRequest("/api/admin/status");

    expect(stub?.last()?.credentials).toBe("include");
  });

  it("sends no profile header and no session header", async () => {
    // The panel has its own credential. It must not carry the family's.
    await adminRequest("/api/admin/status");

    const headers = stub?.last()?.headers ?? {};
    expect(headers["x-profile-id"]).toBeUndefined();
    expect(headers["x-house-session"]).toBeUndefined();
  });

  it("throws an error carrying the server's code", async () => {
    // The panel branches on the code: a failed sign-in that says
    // "not configured" is a different screen from a wrong password.
    stub?.restore();
    stub = stubFetch(() => fakeResponse({ code: "admin_not_configured" }, { status: 401 }));

    const error = await adminRequest("/api/admin/login", { method: "POST", body: { password: "x" } })
      .then(() => null)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AdminRequestError);
    expect((error as AdminRequestError).code).toBe("admin_not_configured");
    expect((error as AdminRequestError).status).toBe(401);
  });

  it("carries the status even when the body has no code", async () => {
    stub?.restore();
    stub = stubFetch(() => fakeResponse(undefined, { status: 500 }));

    const error = await adminRequest("/api/admin/status")
      .then(() => null)
      .catch((caught: unknown) => caught);

    expect((error as AdminRequestError).status).toBe(500);
    expect((error as AdminRequestError).code).toBeNull();
  });

  it("shows the server's code when there is one", async () => {
    // The panel is an operator surface, and the code is what they can grep
    // the server log for. That was the existing behaviour, so it is kept.
    stub?.restore();
    stub = stubFetch(() => fakeResponse({ code: "a_code_from_a_newer_server" }, { status: 409 }));

    await expect(adminRequest("/api/admin/status")).rejects.toThrow(
      "a_code_from_a_newer_server",
    );
  });

  it("falls back to the panel's own sentence when there is no code", async () => {
    stub?.restore();
    stub = stubFetch(() => fakeResponse(undefined, { status: 502 }));

    await expect(adminRequest("/api/admin/status")).rejects.toThrow(
      copyAdmin.shell.requestFailed,
    );
  });

  it("returns the parsed body", async () => {
    stub?.restore();
    stub = stubFetch(() => fakeResponse({ adminConfigured: true }));

    expect(await adminRequest("/api/admin/config")).toEqual({ adminConfigured: true });
  });

  it("returns undefined for a 204", async () => {
    stub?.restore();
    stub = stubFetch(() => fakeResponse(undefined, { status: 204 }));

    expect(await adminRequest("/api/admin/logout", { method: "POST" })).toBeUndefined();
  });

  it("sends a JSON body when one is given", async () => {
    await adminRequest("/api/admin/login", { method: "POST", body: { password: "secret" } });

    expect(stub?.last()?.method).toBe("POST");
    expect(stub?.last()?.headers["content-type"]).toBe("application/json");
    expect(stub?.last()?.body).toBe(JSON.stringify({ password: "secret" }));
  });
});

describe("adminRequestRaw", () => {
  it("hands back the response so the caller can read the status", async () => {
    // The dashboard needs to tell a 401 (sign out) from any other failure.
    stub?.restore();
    stub = stubFetch(() => fakeResponse(undefined, { status: 401 }));

    const response = await adminRequestRaw("/api/admin/status");

    expect(response.status).toBe(401);
  });

  it("does not throw on a failure -- the caller decides", async () => {
    stub?.restore();
    stub = stubFetch(() => fakeResponse(undefined, { status: 502 }));

    const response = await adminRequestRaw("/api/admin/status");

    expect(response.status).toBe(502);
  });
});

describe("the admin bundle's imports", () => {
  it("does not import the family client", () => {
    // ADR 022: the panel is a different door. Dragging the family's session
    // handling, copy catalogue and private cache into its build would couple
    // two applications that are deliberately separate. `lib/bounded` is
    // allowed -- it is the shared deadline rule and carries no app state.
    for (const file of ["request.ts", "main.tsx", "copy.ts"]) {
      const source = readFileSync(resolve(__dirname, file), "utf8");
      expect(source, file).not.toMatch(/from "\.\.\/lib\/api"/);
      expect(source, file).not.toMatch(/from "\.\.\/copy"/);
    }
  });
});
