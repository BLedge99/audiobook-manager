import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { mediaAssetUrl } from "./api";
import { usePlayerSource } from "./usePlayerSource";
import type { PlaybackSource } from "./playback";

/**
 * The hook is mocked at the API boundary rather than exercised against a real
 * server: the interesting behaviour is what it does when a token request
 * fails, hangs or is not needed, which is exactly what cannot be reproduced by
 * standing up a Fastify instance.
 */
vi.mock("./api", () => ({
  apiUrl: (path: string) => `http://server${path}`,
  mediaAssetUrl: vi.fn(),
}));

const streamFor = (id: number): string => `http://server/api/audiobooks/${id}/stream?media=TOKEN`;
const trackStreamFor = (id: number): string => `http://server/api/tracks/${id}/stream?media=TOKEN`;

const chapterBookSource: PlaybackSource = {
  key: "book:1",
  path: "/api/audiobooks/1/stream",
  kind: "book",
  id: 1,
  // A one-file chapter book is streamed as the whole book, and its file is
  // its single track -- which is what makes the downloaded copy usable.
  localTrackId: 41,
};

const trackSource: PlaybackSource = {
  key: "track:12",
  path: "/api/tracks/12/stream",
  kind: "track",
  id: 12,
  localTrackId: 12,
};

describe("usePlayerSource", () => {
  beforeEach(() => {
    vi.mocked(mediaAssetUrl).mockReset();
    vi.mocked(mediaAssetUrl).mockImplementation(async (path: string) => `http://server${path}?media=TOKEN`);
  });

  it("prefers the downloaded file when the device has one", async () => {
    const { result } = renderHook(() =>
      usePlayerSource({
        bookId: 1,
        source: chapterBookSource,
        localUrlForTrack: async () => "capacitor-file://book/41.mp3",
      }));

    await waitFor(() => expect(result.current.resolved?.local).toBe(true));
    expect(result.current.resolved?.url).toBe("capacitor-file://book/41.mp3");
    expect(result.current.resolved?.sourceKey).toBe("book:1");
    // The stream is not even requested: the file is already here.
    expect(mediaAssetUrl).not.toHaveBeenCalled();
  });

  it("streams when there is no downloaded copy", async () => {
    const { result } = renderHook(() =>
      usePlayerSource({
        bookId: 1,
        source: chapterBookSource,
        localUrlForTrack: async () => undefined,
      }));

    await waitFor(() => expect(result.current.resolved?.local).toBe(false));
    expect(result.current.resolved?.url).toBe(streamFor(1));
  });

  it("never returns an empty URL when the media token fails", async () => {
    vi.mocked(mediaAssetUrl).mockRejectedValue(new Error("401"));
    const { result } = renderHook(() =>
      usePlayerSource({ bookId: 1, source: chapterBookSource }));

    await waitFor(() => expect(result.current.resolved).not.toBeNull());
    // This is the bug that made the Android player show "Playback could not
    // start": the shell set `src = ""` when the token round-trip failed.
    expect(result.current.resolved?.url).toBe("http://server/api/audiobooks/1/stream");
    expect(result.current.resolved?.url).not.toBe("");
  });

  it("never returns an empty URL when the media token hangs", async () => {
    vi.mocked(mediaAssetUrl).mockImplementation(() => new Promise<string>(() => undefined));
    const { result } = renderHook(() =>
      usePlayerSource({ bookId: 1, source: chapterBookSource }));

    await waitFor(() => expect(result.current.resolved).not.toBeNull(), { timeout: 7000 });
    expect(result.current.resolved?.url).toBe("http://server/api/audiobooks/1/stream");
  }, 10_000);

  it("streams a track from its own source", async () => {
    const { result } = renderHook(() =>
      usePlayerSource({ bookId: 2, source: trackSource }));

    await waitFor(() => expect(result.current.resolved).not.toBeNull());
    expect(result.current.resolved?.url).toBe(trackStreamFor(12));
    expect(result.current.resolved?.sourceKey).toBe("track:12");
    expect(mediaAssetUrl).toHaveBeenCalledWith("/api/tracks/12/stream", "track-stream", 12);
  });

  /**
   * Regression: `010c779` cached "no local file" for a track before the
   * resolution had actually happened, and `localUrlForTrack` returns
   * `undefined` both for "not downloaded" and for "the replica is still
   * loading". Opening a book quickly after launch therefore played it from the
   * network forever -- and with the network off, not at all.
   */
  it("re-tries the device copy when the device library finishes loading", async () => {
    const withoutReplica = async (): Promise<string | undefined> => undefined;
    const withReplica = async (): Promise<string | undefined> => "capacitor-file://book/41.mp3";

    const { result, rerender } = renderHook(
      ({ resolver }: { resolver: () => Promise<string | undefined> }) =>
        usePlayerSource({ bookId: 1, source: chapterBookSource, localUrlForTrack: resolver }),
      { initialProps: { resolver: withoutReplica } },
    );

    await waitFor(() => expect(result.current.resolved?.local).toBe(false));

    rerender({ resolver: withReplica });

    await waitFor(() => expect(result.current.resolved?.local).toBe(true));
    expect(result.current.resolved?.url).toBe("capacitor-file://book/41.mp3");
  });

  it("falls back to streaming when the downloaded file will not load", async () => {
    const { result } = renderHook(() =>
      usePlayerSource({
        bookId: 1,
        source: chapterBookSource,
        localUrlForTrack: async () => "capacitor-file://book/41.mp3",
      }));

    await waitFor(() => expect(result.current.resolved?.local).toBe(true));

    act(() => result.current.markLocalFailed());

    await waitFor(() => expect(result.current.resolved?.local).toBe(false));
    expect(result.current.resolved?.url).toBe(streamFor(1));
  });

  /**
   * Spec 30: an offline book adopted or downloaded from another server lives
   * in that server's shelf, so the local copy is resolved through the shelf,
   * not merely through "the server we are pointed at".
   */
  it("resolves the local copy through the book's server shelf", async () => {
    const resolver = vi.fn(async (_bookId: number, _trackId: number, serverId?: string) =>
      serverId === "http://localhost:3000" ? "capacitor-file://book/41.mp3" : undefined,
    );
    const { result } = renderHook(() =>
      usePlayerSource({
        bookId: 1,
        source: chapterBookSource,
        localUrlForTrack: resolver,
        serverId: "http://localhost:3000",
      }));

    await waitFor(() => expect(result.current.resolved?.local).toBe(true));
    expect(result.current.resolved?.url).toBe("capacitor-file://book/41.mp3");
    expect(resolver).toHaveBeenCalledWith(1, 41, "http://localhost:3000");
  });

  it("streams when the local copy lives in a different server shelf", async () => {
    const resolver = vi.fn(async (_bookId: number, _trackId: number, serverId?: string) =>
      serverId === "http://localhost:3000" ? "capacitor-file://book/41.mp3" : undefined,
    );
    const { result } = renderHook(() =>
      usePlayerSource({
        bookId: 1,
        source: chapterBookSource,
        localUrlForTrack: resolver,
        serverId: "https://audiobook-manager.onrender.com",
      }));

    await waitFor(() => expect(result.current.resolved?.local).toBe(false));
    expect(result.current.resolved?.url).toBe(streamFor(1));
  });

  it("keeps the local failure scoped to the source that failed", async () => {
    const { result, rerender } = renderHook(
      ({ source }: { source: PlaybackSource }) =>
        usePlayerSource({
          bookId: 1,
          source,
          localUrlForTrack: async () => "capacitor-file://book/local.mp3",
        }),
      { initialProps: { source: chapterBookSource } },
    );

    await waitFor(() => expect(result.current.resolved?.local).toBe(true));
    act(() => result.current.markLocalFailed());
    await waitFor(() => expect(result.current.resolved?.local).toBe(false));

    // The next file on the device is still preferred: one bad file must not
    // disable downloaded playback for the rest of the book.
    rerender({ source: trackSource });
    await waitFor(() => expect(result.current.resolved?.sourceKey).toBe("track:12"));
    expect(result.current.resolved?.local).toBe(true);
  });

  it("mints a fresh token when asked to retry", async () => {
    const { result } = renderHook(() =>
      usePlayerSource({ bookId: 1, source: chapterBookSource }));

    await waitFor(() => expect(result.current.resolved).not.toBeNull());
    const callsBefore = vi.mocked(mediaAssetUrl).mock.calls.length;

    act(() => result.current.retry());

    await waitFor(() => expect(result.current.attempt).toBe(1));
    await waitFor(() =>
      expect(vi.mocked(mediaAssetUrl).mock.calls.length).toBeGreaterThan(callsBefore));
  });
});
