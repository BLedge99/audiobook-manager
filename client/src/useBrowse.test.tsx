import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useBrowse } from "./useBrowse";
import { getServerUrl } from "./lib/api";

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

function mount(profileId: string | null = null) {
  return renderHook(({ id }: { id: string | null }) => useBrowse(id), {
    initialProps: { id: profileId },
  });
}

describe("useBrowse", () => {
  it("asks for credentials, so the session cookie travels", async () => {
    // The Android WebView is cross-origin from the server, so a request
    // without `credentials: "include"` arrives with no session cookie and
    // 401s. This used to be the global fetch shim's job, which meant the
    // guarantee did not belong to the call site at all.
    fetchMock.mockImplementation(async () => fakeResponse([]));
    const view = mount("7");
    await waitFor(() => expect(view.result.current.loaded).toBe(true));

    expect(fetchMock.mock.calls[0]?.[1]?.credentials).toBe("include");
  });

  it("fetches favourites for the signed-in profile on mount", async () => {
    window.localStorage.setItem("profileId", "7");
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith("/api/favourites/ids")) return fakeResponse([1, 2, 3]);
      return fakeResponse([]);
    });

    const view = mount();
    await waitFor(() => expect(view.result.current.favourites).toEqual([1, 2, 3]));

    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/api/favourites/ids"))).toBe(true);
    // The favourites are cached against the server they came from, so two
    // shelves keep two separate lists.
    expect(cacheMocks.cacheFavourites).toHaveBeenCalledWith([1, 2, 3], getServerUrl());
  });

  it("re-fetches favourites when the profileId changes", async () => {
    // The profile id arrives as a parameter. It used to be read from
    // localStorage during render, which meant the hook polled a global to
    // notice a change it should have been told about.
    let currentProfile: string | null = "7";
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith("/api/favourites/ids")) {
        return fakeResponse(currentProfile === "7" ? [1, 2, 3] : [4, 5]);
      }
      return fakeResponse([]);
    });

    const view = renderHook(({ id }: { id: string | null }) => useBrowse(id), {
      initialProps: { id: "7" as string | null },
    });
    await waitFor(() => expect(view.result.current.favourites).toEqual([1, 2, 3]));

    // Switch to profile 8.
    currentProfile = "8";
    act(() => {
      view.rerender({ id: "8" });
    });

    await waitFor(() => expect(view.result.current.favourites).toEqual([4, 5]));
    expect(cacheMocks.cacheFavourites).toHaveBeenCalledWith([4, 5], getServerUrl());
  });

  it("falls back to cached favourites for the new profile when the server is unreachable", async () => {
    cacheMocks.readFavourites.mockResolvedValue([9, 10]);
    fetchMock.mockRejectedValue(new Error("server unreachable"));

    const view = mount("7");
    await waitFor(() => expect(view.result.current.favourites).toEqual([9, 10]));
    expect(cacheMocks.readFavourites).toHaveBeenCalled();
  });
});


describe("useBrowse refresh coalescing", () => {
  it("coalesces concurrent refreshes into one trailing batch", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    fetchMock.mockImplementation(async () => {
      await gate;
      return fakeResponse([]);
    });
    const view = mount("7");
    // The mount's initial refresh is stuck behind the gate. Two more requests
    // arrive while it is in flight - they must collapse into ONE trailing run.
    void view.result.current.refresh();
    void view.result.current.refresh();
    release();
    await waitFor(() => expect(view.result.current.loaded).toBe(true));
    // Five endpoints per batch; without coalescing this is 15 calls.
    expect(fetchMock.mock.calls.length).toBe(10);
  });
});
