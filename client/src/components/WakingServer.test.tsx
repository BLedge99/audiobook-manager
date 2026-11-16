import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WakingServer } from "./WakingServer";
import { copy } from "../copy";

/**
 * Spec 42, step 1.3 — the wake screen's two actions actually fire.
 *
 * The audit found the Retry button was wired to a probe that refused to run
 * while another was in flight, and nothing tested the screen. This suite pins
 * the screen's side of the contract; the App-level suite pins Retry → probe.
 */

describe("WakingServer", () => {
  it("calls onRetry when the listener taps Retry", () => {
    const onRetry = vi.fn();
    render(<WakingServer onRetry={onRetry} onContinueOffline={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: copy.waking.retry }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("calls onContinueOffline when the listener chooses their offline books", () => {
    const onContinueOffline = vi.fn();
    render(<WakingServer onRetry={vi.fn()} onContinueOffline={onContinueOffline} />);

    fireEvent.click(screen.getByRole("button", { name: copy.waking.continueOffline }));
    expect(onContinueOffline).toHaveBeenCalledTimes(1);
  });

  it("announces itself as a status, not an alert", () => {
    // A waking server is not an error; the screen must not shout.
    render(<WakingServer onRetry={vi.fn()} onContinueOffline={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent(copy.waking.title);
  });
});
