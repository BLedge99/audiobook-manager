import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AccountGate } from "./AccountGate";
import { copy } from "../copy";
import { getActiveProfileId, SESSION_TOKEN_KEY } from "../lib/api";

const accounts = [
  {
    id: 7,
    name: "Ben",
    color: "var(--mint)",
    role: "member",
    disabled: false,
    hasPassword: true,
    hasPasskey: true,
  },
  {
    id: 8,
    name: "Mum",
    color: "var(--tan)",
    role: "member",
    disabled: false,
    hasPassword: false,
    hasPasskey: false,
  },
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch(overrides: Record<string, (init?: RequestInit) => Response> = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const override = Object.entries(overrides).find(([suffix]) => url.endsWith(suffix));
    if (override) return override[1](init);
    if (url.endsWith("/api/auth/accounts")) return json(accounts);
    return json({ code: "not_found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("AccountGate", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("lists accounts and signs in with that profile's password", async () => {
    mockFetch({
      "/api/auth/login": (init) => {
        const body = JSON.parse(String(init?.body));
        return body.password === "correct-horse-9"
          ? json({ ok: true, token: "session-token", profile: { id: 7 }, role: "member" })
          : json({ code: "incorrect_password" }, 401);
      },
    });
    const onSuccess = vi.fn();
    render(<AccountGate onSuccess={onSuccess} />);

    fireEvent.click(await screen.findByRole("button", { name: /Ben/ }));
    expect(screen.getByPlaceholderText(copy.account.passwordPlaceholder)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(copy.account.passwordPlaceholder), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: copy.login.submit }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(copy.login.wrongPassword));

    fireEvent.change(screen.getByPlaceholderText(copy.account.passwordPlaceholder), {
      target: { value: "correct-horse-9" },
    });
    fireEvent.click(screen.getByRole("button", { name: copy.login.submit }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(window.localStorage.getItem(SESSION_TOKEN_KEY)).toBe("session-token");
    expect(getActiveProfileId()).toBe("7");
  });

  it("opens the claim form for a profile with no password", async () => {
    mockFetch({
      "/api/auth/claim": () =>
        json({ ok: true, token: "claimed-token", profile: { id: 8 }, role: "member" }),
    });
    const onSuccess = vi.fn();
    render(<AccountGate onSuccess={onSuccess} />);

    fireEvent.click(await screen.findByRole("button", { name: /Mum/ }));
    expect(screen.getByText(copy.account.unclaimedHint)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(copy.login.passwordPlaceholder), {
      target: { value: "household" },
    });
    fireEvent.change(screen.getByPlaceholderText(copy.account.newPasswordLabel), {
      target: { value: "new-password-9" },
    });
    fireEvent.change(screen.getByPlaceholderText(copy.account.confirmPasswordLabel), {
      target: { value: "new-password-9" },
    });
    fireEvent.click(screen.getByRole("button", { name: copy.account.setupSubmit }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(getActiveProfileId()).toBe("8");
  });

  it("rejects a mismatched confirmation without calling the server", async () => {
    const fetchMock = mockFetch();
    render(<AccountGate onSuccess={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: /Mum/ }));
    fireEvent.change(screen.getByPlaceholderText(copy.login.passwordPlaceholder), {
      target: { value: "household" },
    });
    fireEvent.change(screen.getByPlaceholderText(copy.account.newPasswordLabel), {
      target: { value: "new-password-9" },
    });
    fireEvent.change(screen.getByPlaceholderText(copy.account.confirmPasswordLabel), {
      target: { value: "different-password-9" },
    });
    fireEvent.click(screen.getByRole("button", { name: copy.account.setupSubmit }));

    expect(screen.getByRole("alert")).toHaveTextContent(copy.account.mismatch);
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/auth/claim",
      expect.anything(),
    );
  });

  it("keeps the household password as a separate recovery mode", async () => {
    mockFetch({
      "/api/auth/login": () => json({ ok: true, token: "household-token", role: "admin", profile: null }),
    });
    const onSuccess = vi.fn();
    render(<AccountGate onSuccess={onSuccess} />);

    fireEvent.click(await screen.findByRole("button", { name: copy.account.useHousehold }));
    expect(screen.getByText(copy.account.householdIntro)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(copy.login.passwordPlaceholder), {
      target: { value: "household" },
    });
    fireEvent.click(screen.getByRole("button", { name: copy.login.submit }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(window.localStorage.getItem(SESSION_TOKEN_KEY)).toBe("household-token");
    expect(getActiveProfileId()).toBeNull();
  });
});
