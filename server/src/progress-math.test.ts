import { describe, it, expect } from "vitest";
import { clampPosition, normalizeSessionBounds, normalizeSessionSpeed, resolveCompleted, COMPLETION_RATIO, MAX_PLAYBACK_SPEED } from "./progress-math";

describe("clampPosition", () => {
  it("clamps an overlong position into the duration", () => {
    expect(clampPosition(99999, 1000)).toBe(1000);
  });

  it("clamps a negative position to the start", () => {
    expect(clampPosition(-50, 1000)).toBe(0);
  });

  it("resolves to the start when no usable duration is known", () => {
    expect(clampPosition(42, 0)).toBe(42);
    expect(clampPosition(42, 0)).toBe(42);
    expect(clampPosition(-7, 0)).toBe(0);
  });
});

describe("resolveCompleted", () => {
  it("defaults to completed at the completion ratio", () => {
    expect(resolveCompleted(960, 1000, undefined)).toBe(true);
    expect(resolveCompleted(100, 1000, undefined)).toBe(false);
  });

  it("honours an explicit completed value", () => {
    expect(resolveCompleted(10, 1000, false)).toBe(false);
    expect(resolveCompleted(10, 1000, true)).toBe(true);
  });
});

describe("normalizeSessionBounds", () => {
  it("keeps positions non-negative and inside the book", () => {
    expect(normalizeSessionBounds(120, 30, 1000)).toEqual({ from: 30, to: 120 });
  });

  it("rejects from beyond to", () => {
    expect(normalizeSessionBounds(10, 90, 1000)).toEqual({ from: 10, to: 10 });
  });
});

describe("normalizeSessionSpeed", () => {
  it("caps speed at the maximum", () => {
    expect(normalizeSessionSpeed(25)).toBe(MAX_PLAYBACK_SPEED);
  });

  it("falls back to normal speed when absent or invalid", () => {
    expect(normalizeSessionSpeed(Number.NaN)).toBe(1);
    expect(normalizeSessionSpeed(0)).toBe(1);
    expect(normalizeSessionSpeed(-3)).toBe(1);
    expect(normalizeSessionSpeed(2)).toBe(2);
  });

  it("exposes the completion ratio the server applies", () => {
    expect(COMPLETION_RATIO).toBe(0.95);
  });
});
