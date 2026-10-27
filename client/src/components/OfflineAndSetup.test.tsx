import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OfflineNotice, Splash } from "./OfflineNotice";
import { ServerSetup } from "./ServerSetup";

/**
 * The bug these cover: an unreachable server was indistinguishable from being
 * logged out, so the app demanded a password it could never check. Someone who
 * had downloaded a book to listen to on a plane was locked out of it by the
 * feature that let them download it.
 */

describe("OfflineNotice", () => {
  beforeEach(() => window.localStorage.clear());

  it("does not ask for a password — there is nothing to authenticate against", () => {
    render(<OfflineNotice hasBooks={false} onRetry={() => {}} />);
    expect(screen.queryByPlaceholderText(/household password/i)).not.toBeInTheDocument();
    expect(screen.getByText(/reach the server/i)).toBeInTheDocument();
  });

  it("explains what to do when nothing is downloaded yet", () => {
    render(<OfflineNotice hasBooks={false} onRetry={() => {}} />);
    expect(screen.getByText(/download a book/i)).toBeInTheDocument();
  });

  it("explains how to restore offline listening when books are downloaded", () => {
    render(<OfflineNotice hasBooks onRetry={() => {}} />);
    expect(screen.getByText(/books are on this phone/i)).toBeInTheDocument();
    expect(screen.queryByText(/download a book/i)).not.toBeInTheDocument();
  });

  it("offers a retry", () => {
    const onRetry = vi.fn();
    render(<OfflineNotice hasBooks={false} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("offers a route to correct the server address", () => {
    const onChangeServer = vi.fn();
    render(<OfflineNotice hasBooks onRetry={() => {}} onChangeServer={onChangeServer} />);
    fireEvent.click(screen.getByRole("button", { name: /change server address/i }));
    expect(onChangeServer).toHaveBeenCalledOnce();
  });
});

describe("Splash", () => {
  it("waits without demanding credentials", () => {
    render(<Splash />);
    expect(screen.getByText(/connecting/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/household password/i)).not.toBeInTheDocument();
  });
});

describe("ServerSetup", () => {
  beforeEach(() => {
    window.localStorage.clear();
    // The health probe is a network call; stub it per test.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  });

  it("persists a valid address and continues", async () => {
    const onDone = vi.fn();
    render(<ServerSetup onDone={onDone} />);

    fireEvent.change(screen.getByPlaceholderText(/192\.168/), { target: { value: "192.168.1.203:3000" } });
    fireEvent.click(screen.getByRole("button", { name: /connect/i }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    // Normalised with a scheme, so the user need not type one.
    expect(window.localStorage.getItem("serverUrl")).toBe("http://192.168.1.203:3000");
  });

  it("prefills the saved address so it can be corrected", () => {
    window.localStorage.setItem("serverUrl", "http://192.168.1.203:3000");
    render(<ServerSetup onDone={() => {}} />);
    expect(screen.getByLabelText(/server address/i)).toHaveValue("http://192.168.1.203:3000");
  });

  it("rejects nonsense without persisting it", async () => {
    const onDone = vi.fn();
    render(<ServerSetup onDone={onDone} />);

    fireEvent.change(screen.getByPlaceholderText(/192\.168/), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /connect/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(window.localStorage.getItem("serverUrl")).toBeNull();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("reports an unreachable server distinctly from a bad address", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network error"); }));
    const onDone = vi.fn();
    render(<ServerSetup onDone={onDone} />);

    fireEvent.change(screen.getByPlaceholderText(/192\.168/), { target: { value: "192.168.1.203:3000" } });
    fireEvent.click(screen.getByRole("button", { name: /connect/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument(), { timeout: 5000 });
    expect(screen.getByRole("alert").textContent).toMatch(/could not reach/i);
    expect(onDone).not.toHaveBeenCalled();
  });
});