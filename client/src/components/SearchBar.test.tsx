import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { SearchBar } from "./SearchBar";

/**
 * Spec 22 — the search input.
 *
 * The matching rules are tested in `lib/search.test.ts`. What matters here is
 * that the component reports a change, debounces it rather than filtering on
 * every keystroke, and follows an externally cleared value.
 */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function type(input: HTMLElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("SearchBar", () => {
  it("is labelled as a search input", () => {
    render(<SearchBar value="" onChange={() => {}} resultCount={0} />);
    expect(screen.getByRole("searchbox", { name: /search the library/i })).toBeTruthy();
  });

  it("debounces: does not call onChange before the timer fires", () => {
    const onChange = vi.fn();
    render(<SearchBar value="" onChange={onChange} resultCount={0} />);
    const input = screen.getByRole("searchbox");
    type(input, "author: rowling");
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(onChange).toHaveBeenCalledWith("author: rowling");
  });

  it("only reports the latest value when typed quickly", () => {
    const onChange = vi.fn();
    render(<SearchBar value="" onChange={onChange} resultCount={0} />);
    const input = screen.getByRole("searchbox");
    type(input, "row");
    act(() => {
      vi.advanceTimersByTime(100);
    });
    type(input, "rowling");
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith("rowling");
  });

  it("reports a match count once a query is active", () => {
    render(<SearchBar value="author: rowling" onChange={() => {}} resultCount={2} />);
    expect(screen.getByRole("status").textContent).toContain("2 matches");
    expect(screen.getByRole("status").textContent).toContain("author: rowling");
  });

  it("uses the singular for one match", () => {
    render(<SearchBar value="genre: thriller" onChange={() => {}} resultCount={1} />);
    expect(screen.getByRole("status").textContent).toContain("1 match");
  });

  it("offers example queries when idle", () => {
    render(<SearchBar value="" onChange={() => {}} resultCount={0} />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "genre: thriller" })).toBeTruthy();
  });

  it("clears on the clear button", () => {
    const onChange = vi.fn();
    render(<SearchBar value="rowling" onChange={onChange} resultCount={1} />);
    act(() => {
      screen.getByRole("button", { name: /clear search/i }).click();
    });
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("clears on Escape", () => {
    const onChange = vi.fn();
    render(<SearchBar value="rowling" onChange={onChange} resultCount={1} />);
    const input = screen.getByRole("searchbox");
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("adopts an externally cleared value", () => {
    const { rerender } = render(<SearchBar value="rowling" onChange={() => {}} resultCount={1} />);
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("rowling");
    rerender(<SearchBar value="" onChange={() => {}} resultCount={6} />);
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
  });

  it("fills the box from an example query", () => {
    render(<SearchBar value="" onChange={() => {}} resultCount={0} />);
    act(() => {
      screen.getByRole("button", { name: "tag: bedtime" }).click();
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("tag: bedtime");
  });
});