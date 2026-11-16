import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeToggle, Notice, EmptyPanel, Btn, Backdrop, CloseButton, PageHead, MachineMark } from "./primitives";
import { copy } from "../copy";

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

/**
 * Spec 42, step 8.2 — direct contracts for the absorbing primitives.
 *
 * These surfaces carry 75+ call-site references between them and had no
 * direct pins of their own; every incidental coverage went through the
 * screens. The contracts pinned here are the ones the rest of the app
 * depends on: Notice's role switching, the glass variant's class, the
 * backdrop/close-button pair, PageHead's heading shape, MachineMark's
 * aria-hidden mark.
 */

describe("Notice", () => {
  it("announces politely by default and assertively on demand", () => {
    const { rerender } = render(<Notice>All good.</Notice>);
    expect(screen.getByRole("status")).toHaveTextContent("All good.");
    rerender(<Notice role="alert" tone="error">It broke.</Notice>);
    expect(screen.getByRole("alert")).toHaveTextContent("It broke.");
  });

  it("colours the border family by tone", () => {
    const { rerender, container } = render(<Notice tone="error">nope</Notice>);
    expect((container.firstElementChild as HTMLElement).style.background).toContain("--rasp");
    rerender(<Notice tone="warn">careful</Notice>);
    expect((container.firstElementChild as HTMLElement).style.background).toContain("--tan");
    rerender(<Notice tone="info">fyi</Notice>);
    expect((container.firstElementChild as HTMLElement).style.background).toContain("--cobalt");
  });
});

describe("EmptyPanel", () => {
  it("renders its children in the sunk empty-state treatment", () => {
    const { container } = render(<EmptyPanel>Nothing here yet.</EmptyPanel>);
    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass("panel--sunk");
  });
});

describe("Btn variant=\"glass\"", () => {
  it("applies the glass class, and only that family of extras", () => {
    render(<Btn variant="glass">Continue</Btn>);
    const button = screen.getByRole("button", { name: "Continue" });
    expect(button).toHaveClass("btn", "btn--glass");
    expect(button).not.toHaveClass("btn--primary");
  });

  it("pairs with the small size without leaking other variants", () => {
    render(<Btn variant="glass" size="sm">Go</Btn>);
    expect(screen.getByRole("button", { name: "Go" })).toHaveClass("btn", "btn--glass", "btn--sm");
  });
});

describe("Backdrop and CloseButton", () => {
  it("the backdrop closes on click and names the action for screen readers", () => {
    const onClose = vi.fn();
    render(<Backdrop onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: copy.buyLinks.close }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("the close button closes on click and names the action for screen readers", () => {
    const onClose = vi.fn();
    render(<CloseButton onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: copy.buyLinks.close }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("PageHead", () => {
  it("renders the title as a heading and the intro only when given", () => {
    const { rerender } = render(<PageHead title="Discover" />);
    expect(screen.getByRole("heading", { name: "Discover" })).toBeInTheDocument();
    expect(screen.queryByText(/some intro/)).not.toBeInTheDocument();
    rerender(<PageHead title="Discover">some intro text</PageHead>);
    expect(screen.getByText("some intro text")).toBeInTheDocument();
  });
});

describe("MachineMark", () => {
  it("renders the mark as decorative (aria-hidden)", () => {
    const { container } = render(<MachineMark />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });
});
