import { describe, it, expect } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { LocalLibraryDatabase } from "./db";
import { useExternalItems } from "./useExternalItems";

const AUDIBLE_URL = "https://www.audible.com/pd/The-Count-of-Monte-Cristo/B00S2LTCQK";
const LIBROFM_URL = "https://libro.fm/audiobooks/9781705085059-fourth-wing";

function freshDb() {
  return new LocalLibraryDatabase(`test-hook-${crypto.randomUUID()}`);
}

describe("useExternalItems", () => {
  it("loads empty initially", async () => {
    const db = freshDb();
    const { result, unmount } = renderHook(() => useExternalItems(db));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toEqual([]);
    unmount();
    await db.delete();
  });

  it("add inserts the item and the list reflects it", async () => {
    const db = freshDb();
    const { result, unmount } = renderHook(() => useExternalItems(db));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.add(AUDIBLE_URL, { author: "Alexandre Dumas" });
    });
    expect(outcome).toMatchObject({ ok: true, created: true });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toMatchObject({ store: "audible", author: "Alexandre Dumas" });
    unmount();
    await db.delete();
  });

  it("add is idempotent for the same URL", async () => {
    const db = freshDb();
    const { result, unmount } = renderHook(() => useExternalItems(db));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.add(AUDIBLE_URL);
    });
    await act(async () => {
      await result.current.add(AUDIBLE_URL);
    });
    expect(result.current.items).toHaveLength(1);
    unmount();
    await db.delete();
  });

  it("remove deletes and reload re-reads the table", async () => {
    const db = freshDb();
    const { result, unmount } = renderHook(() => useExternalItems(db));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.add(AUDIBLE_URL);
      await result.current.add(LIBROFM_URL);
    });
    expect(result.current.items).toHaveLength(2);
    const id = result.current.items.find((item) => item.store === "audible")!.id;
    await act(async () => {
      await result.current.remove(id);
    });
    expect(result.current.items.map((item) => item.store)).toEqual(["librofm"]);
    unmount();
    await db.delete();
  });

  it("add surfaces a coded rejection for unsupported hosts, without crashing state", async () => {
    const db = freshDb();
    const { result, unmount } = renderHook(() => useExternalItems(db));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.add("https://example.com/x");
    });
    expect(outcome).toEqual({ ok: false, code: "unsupported-host" });
    expect(result.current.items).toEqual([]);
    unmount();
    await db.delete();
  });
});
