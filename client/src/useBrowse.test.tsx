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

  it("caches a favourite locally when the server is unreachable", async () => {
    window.localStorage.setItem("profileId", "7");
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith("/api/favourites/ids")) return fakeResponse([1]);
      if (String(url).includes("/favourite")) throw new Error("offline");
      return fakeResponse([]);
    });
    cacheMocks.readFavourites.mockResolvedValue([1]);

    const view = mount();
    await waitFor(() => expect(view.result.current.favourites).toEqual([1]));

    await act(async () => {
      await view.result.current.toggleFavourite(2);
    });

    expect(cacheMocks.cacheFavourites).toHaveBeenCalledWith([1, 2]);
    expect(view.result.current.favourites).toContain(2);
  });

  it("removes a favourite from the local cache when the server is unreachable", async () => {
    window.localStorage.setItem("profileId", "7");
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith("/api/favourites/ids")) return fakeResponse([1, 2]);
      if (String(url).includes("/favourite")) throw new Error("offline");
      return fakeResponse([]);
    });
    cacheMocks.readFavourites.mockResolvedValue([1, 2]);

    const view = mount();
    await waitFor(() => expect(view.result.current.favourites).toEqual([1, 2]));

    await act(async () => {
      await view.result.current.toggleFavourite(2);
    });

    expect(cacheMocks.cacheFavourites).toHaveBeenCalledWith([1]);
    expect(view.result.current.favourites).toEqual([1]);
  });

  it("caches favourites when genres endpoint fails", async () => {
    window.localStorage.setItem("profileId", "7");
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith("/api/favourites/ids")) return fakeResponse([5, 6]);
      if (String(url).endsWith("/api/genres")) throw new Error("down");
      return fakeResponse([]);
    });

    const view = mount();
    await waitFor(() => expect(view.result.current.favourites).toEqual([5, 6]));

    expect(cacheMocks.cacheFavourites).toHaveBeenCalledWith([5, 6]);
    expect(view.result.current.loaded).toBe(true);
  });

  it("syncFavourites pushes mobile-only additions to the server and keeps server-only ids", async () => {
    window.localStorage.setItem("profileId", "7");
    const posted: number[] = [];
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith("/api/favourites/ids")) return fakeResponse([1, 9]);
      if (String(url).includes("/favourite")) {
        const match = String(url).match(/\/(\d+)\/favourite$/);
        if (match) posted.push(Number(match[1]));
        return fakeResponse(undefined, 204);
      }
      return fakeResponse([]);
    });
    cacheMocks.readFavourites.mockResolvedValue([1, 2]);

    const view = mount();
    // Let refresh() set favourites from the server first ([1, 9]), merged with
    // the cached [1, 2] -> [1, 9, 2].
    await waitFor(() => expect(view.result.current.favourites).toEqual([1, 9, 2]));

    await act(async () => {
      await view.result.current.syncFavourites();
    });

    // Mobile-only id 2 pushed to server; server-only id 9 kept.
    expect(posted).toEqual([2]);
    expect(cacheMocks.cacheFavourites).toHaveBeenCalledWith([1, 2, 9]);
    expect(view.result.current.favourites).toEqual([1, 2, 9]);
  });

  it("syncFavourites syncs multiple mobile-only additions to the server", async () => {
    window.localStorage.setItem("profileId", "7");
    const posted: number[] = [];
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith("/api/favourites/ids")) return fakeResponse([1]);
      if (String(url).includes("/favourite")) {
        const match = String(url).match(/\/(\d+)\/favourite$/);
        if (match) posted.push(Number(match[1]));
        return fakeResponse(undefined, 204);
      }
      return fakeResponse([]);
    });
    cacheMocks.readFavourites.mockResolvedValue([1, 2, 3, 4]);

    const view = mount();
    // Let refresh() merge server [1] with cached [1, 2, 3, 4] -> [1, 2, 3, 4].
    await waitFor(() => expect(view.result.current.favourites).toEqual([1, 2, 3, 4]));

    await act(async () => {
      await view.result.current.syncFavourites();
    });

    expect(posted).toEqual([2, 3, 4]);
    expect(cacheMocks.cacheFavourites).toHaveBeenCalledWith([1, 2, 3, 4]);
    expect(view.result.current.favourites).toEqual([1, 2, 3, 4]);
  });
});
