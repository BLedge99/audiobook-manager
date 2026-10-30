import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useBrowse } from "./useBrowse";

let fetchMock: ReturnType<typeof vi.fn>;

const cacheMocks = vi.hoisted(() => ({
  cacheFavourites: vi.fn(),
  readFavourites: vi.fn(),
}));

vi.mock("./local/privateCache", () => ({
  cacheFavourites: cacheMocks.cacheFavourites,
  readFavourites: cacheMocks.readFavourites,
}));

function fakeResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  window.localStorage.clear();
  cacheMocks.cacheFavourites.mockResolvedValue(true);
  cacheMocks.readFavourites.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mount() {
  return renderHook(() => useBrowse());
}

describe("useBrowse", () => {
  it("fetches favourites for the signed-in profile on mount", async () => {
    window.localStorage.setItem("profileId", "7");
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith("/api/favourites/ids")) return fakeResponse([1, 2, 3]);
      return fakeResponse([]);
    });

    const view = mount();
    await waitFor(() => expect(view.result.current.favourites).toEqual([1, 2, 3]));

    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/api/favourites/ids"))).toBe(true);
    expect(cacheMocks.cacheFavourites).toHaveBeenCalledWith([1, 2, 3]);
  });

  it("re-fetches favourites when the profileId changes", async () => {
    window.localStorage.setItem("profileId", "7");
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith("/api/favourites/ids")) {
        return fakeResponse(window.localStorage.getItem("profileId") === "7" ? [1, 2, 3] : [4, 5]);
      }
      return fakeResponse([]);
    });

    const view = mount();
    await waitFor(() => expect(view.result.current.favourites).toEqual([1, 2, 3]));

    // Switch to profile 8: change localStorage and re-render the hook.
    window.localStorage.setItem("profileId", "8");
    act(() => {
      view.rerender();
    });

    await waitFor(() => expect(view.result.current.favourites).toEqual([4, 5]));
    expect(cacheMocks.cacheFavourites).toHaveBeenCalledWith([4, 5]);
  });

  it("falls back to cached favourites for the new profile when the server is unreachable", async () => {
    window.localStorage.setItem("profileId", "7");
    cacheMocks.readFavourites.mockResolvedValue([9, 10]);
    fetchMock.mockRejectedValue(new Error("server unreachable"));

    const view = mount();
    await waitFor(() => expect(view.result.current.favourites).toEqual([9, 10]));
    expect(cacheMocks.readFavourites).toHaveBeenCalled();
  });
});
