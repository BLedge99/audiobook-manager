import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useAppState } from "./useAppState";

describe("useAppState", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (String(url).endsWith("/config")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ accountExperience: "household" }),
        });
      }
      if (String(url).endsWith("/session")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ role: "member", via: "household" }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([]),
      });
    }));
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("initializes tab from URL query param or defaults to library", () => {
    const { result } = renderHook(() => useAppState());

    expect(result.current.tab).toBe("library");
    expect(result.current.shownTab).toBe("library");
    expect(result.current.filters).toEqual({});
    expect(result.current.search).toBe("");
  });

  it("updates tab and syncs history state", () => {
    const { result } = renderHook(() => useAppState());

    act(() => {
      result.current.openTab("browse");
    });

    expect(result.current.tab).toBe("browse");
    expect(result.current.shownTab).toBe("browse");
  });

  it("handles search changes", () => {
    const { result } = renderHook(() => useAppState());

    act(() => {
      result.current.onSearchChange("Sherlock");
    });

    expect(result.current.search).toBe("Sherlock");
  });
});
