import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import PrivacyNotice from "./PrivacyNotice";

/**
 * Spec 42, phase 4 — the notice must render with the server cold, waking or
 * unreachable. That means the component may not depend on any network at
 * all: a SW-fallback navigation to /privacy renders this with zero requests.
 */

describe("PrivacyNotice (client-side route)", () => {
  beforeEach(() => {
    // Any accidental fetch fails loudly instead of leaking.
    vi.stubGlobal("fetch", vi.fn(() => {
      throw new Error("the notice must render offline");
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the full notice, including the contact line and back link", () => {
    render(<PrivacyNotice />);

    expect(screen.getByRole("heading", { level: 1, name: /privacy notice/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /who we are/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /our legal basis/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /what data we collect/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /your rights/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /contact us/i })).toBeInTheDocument();
    expect(screen.getByText(/privacy@example\.org/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to the app/i })).toHaveAttribute("href", "/");
  });

  it("does not share personal data with third parties — stated, plainly", () => {
    render(<PrivacyNotice />);
    expect(screen.getByText(/do not share your personal data with any third party/i)).toBeInTheDocument();
  });
});
