import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeToggle } from "./primitives";

/**
 * The theme toggle is two states, not three.
 *
 * It used to cycle light -> dark -> "follow the device" -> light, and show
 * the *preference* rather than what was on screen. So a fresh install -- which
 * follows the device -- showed a monitor icon, and clicking it appeared to do
 * nothing whenever the device happened to be in the theme it had already
 * chosen. The household noticed, and was right to.
 */

function mockMatchMedia(prefersDark: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("dark") ? prefersDark : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("the theme toggle", () => {
  it("shows the theme it is in, not the preference it holds", () => {
    // No stored preference: the app follows the device, which is light here.
    mockMatchMedia(false);
    render(<ThemeToggle />);
    // The button says what it will do -- switch to dark -- and the icon is the
    // sun, because it is light.
    const button = screen.getByRole("button", { name: /switch to dark theme/i });
    expect(button).toBeInTheDocument();
    expect(button.querySelector("svg")?.classList.contains("lucide-moon")).toBe(false);
  });

  it("shows the moon on a device that prefers dark", () => {
    mockMatchMedia(true);
    render(<ThemeToggle />);
    const button = screen.getByRole("button", { name: /switch to light theme/i });
    expect(button).toBeInTheDocument();
    expect(button.querySelector("svg")?.classList.contains("lucide-moon")).toBe(true);
  });

  it("has exactly two states: no third icon is ever shown", () => {
    mockMatchMedia(false);
    render(<ThemeToggle />);
    // The monitor icon was the "follow the device" stop. It is gone: the
    // toggle goes from what you can see to the other thing.
    const icons = [...document.querySelectorAll("button svg")].map((svg) => svg.getAttribute("class") ?? "");
    expect(icons.some((cls) => cls.includes("lucide-monitor"))).toBe(false);
  });

  it("one tap from following the device goes to the opposite theme", () => {
    mockMatchMedia(false);
    render(<ThemeToggle />);
    const button = screen.getByRole("button", { name: /switch to dark theme/i });
    button.click();
    // And the preference is now an explicit choice, not "auto".
    expect(window.localStorage.getItem("bookle-theme")).toBe("dark");
  });
});
