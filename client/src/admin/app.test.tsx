import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AdminDashboard, DatabaseExplorer } from "./app";
import { copyAdmin } from "./copy";
import { fakeResponse, stubFetch, type FetchStub } from "../test/requests";

/**
 * The admin panel's screens.
 *
 * The panel had no tests for its screens at all -- the only admin test
 * checked the build wiring. These cover the two surfaces an operator looks
 * at first: the status dashboard and the database explorer.
 */

let stub: FetchStub | null = null;

/** A status payload with the shape the dashboard reads. */
function statusPayload() {
  return {
    generatedAt: "2026-11-11T00:00:00.000Z",
    mode: "household",
    remoteAccess: "lan",
    server: { nodeVersion: "v24.0.0", platform: "linux", uptimeSeconds: 3600, startedAt: null, health: "ok" },
    network: {
      port: 3000, adminPort: 3100, corsOrigins: ["http://books.home.arpa"],
      webauthn: { rpId: null, origin: null }, mediaTokenSecretConfigured: false, tunnel: "none",
    },
    database: { type: "sqlite", configured: true },
    library: { rootCount: 1, bookCount: 12, profileCount: 2, roots: [] },
    scans: { newestScanAt: null },
    enrichment: {
      status: "idle", queued: 0, processed: 0, applied: 0, review: 0, failed: 0, skipped: 0,
      startedAt: null, finishedAt: null, message: null,
    },
    storage: { configured: false, sync: { status: "idle", filesDownloaded: 0, lastSyncAt: null, message: null } },
    freshness: { newestProfileLibraryEntryAt: null },
  };
}

beforeEach(() => {
  stub = stubFetch((url) => {
    if (url.includes("/api/admin/status")) return fakeResponse(statusPayload());
    if (url.includes("/api/admin/library-roots")) return fakeResponse([]);
    if (url.includes("/api/admin/scan/status")) return fakeResponse([]);
    if (url.includes("/api/admin/db/tables")) return fakeResponse({ tables: [] });
    return fakeResponse({});
  });
});

afterEach(() => {
  stub?.restore();
  stub = null;
  vi.unstubAllGlobals();
});

describe("AdminDashboard", () => {
  it("shows the server's status", async () => {
    const onSignOut = vi.fn();
    render(<AdminDashboard onSignOut={onSignOut} />);

    await waitFor(() => expect(screen.getByText(copyAdmin.cards.server)).toBeInTheDocument());
    expect(screen.getByText("v24.0.0")).toBeInTheDocument();
    expect(screen.getByText("sqlite")).toBeInTheDocument();
    // A healthy status must not sign the operator out -- otherwise the 401 test
    // below would pass for the wrong reason.
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it("shows how many books the library holds", async () => {
    render(<AdminDashboard onSignOut={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(copyAdmin.fields.books)).toBeInTheDocument());
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("asks for credentials on every request", async () => {
    render(<AdminDashboard onSignOut={vi.fn()} />);

    await waitFor(() => expect(stub?.calls.length).toBeGreaterThan(0));
    expect(stub?.calls.every((call) => call.credentials === "include")).toBe(true);
  });

  it("signs the operator out when the session has expired", async () => {
    // A 401 on the status request means the admin session is gone. The panel
    // has to return to the sign-in screen rather than showing a stale report.
    stub?.restore();
    stub = stubFetch(() => fakeResponse(undefined, { status: 401 }));
    const onSignOut = vi.fn();

    render(<AdminDashboard onSignOut={onSignOut} />);

    await waitFor(() => expect(onSignOut).toHaveBeenCalled());
  });

  it("says so when the status request fails", async () => {
    stub?.restore();
    stub = stubFetch(() => fakeResponse(undefined, { status: 500 }));

    render(<AdminDashboard onSignOut={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});

describe("DatabaseExplorer", () => {
  it("lists the tables the server offers", async () => {
    stub?.restore();
    stub = stubFetch((url) => {
      if (url.includes("/api/admin/db/tables")) {
        return fakeResponse({ tables: [{ name: "MediaItem", count: 12 }] });
      }
      return fakeResponse({});
    });

    render(<DatabaseExplorer />);

    await waitFor(() => expect(screen.getByRole("button", { name: /MediaItem/ })).toBeInTheDocument());
  });

  it("says so when the table list cannot be read", async () => {
    stub?.restore();
    stub = stubFetch(() => fakeResponse(undefined, { status: 500 }));

    render(<DatabaseExplorer />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
