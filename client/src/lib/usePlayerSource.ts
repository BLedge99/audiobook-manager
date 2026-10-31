import { useCallback, useEffect, useRef, useState } from "react";
import { apiUrl, mediaAssetUrl, type MediaResourceKind } from "./api";
import type { PlaybackSource } from "./playback";

/**
 * Turn the media a listening position needs into a URL the element can load.
 *
 * ## Why this is a hook and not four effects
 *
 * The player used to resolve its own source in two separate effects, one for
 * the downloaded file and one for the stream. Both could end in a state where
 * there was no URL at all -- a chapter book in the Android shell sat with
 * `src = ""` until a media-token round-trip finished, and if that round-trip
 * failed the player showed "Playback could not start" and never recovered.
 *
 * There is now exactly one resolver, and it cannot return an empty URL:
 *
 *   downloaded file  ->  stream with a media token  ->  plain stream URL
 *   (if it exists)       (native shell only)            (last resort)
 *
 * ## The three things it gets right
 *
 * 1. **Never empty.** `apiUrl(path)` is the floor, so the element always has
 *    something to try. A token failure is a *degraded* stream, not silence.
 * 2. **Retries local resolution when the device library changes.** `undefined`
 *    from `localUrlForTrack` means both "not downloaded" and "the replica has
 *    not finished loading", so a cold start used to cache "no local file"
 *    forever. Only a *successful* local resolution is sticky.
 * 3. **The token is not part of the media's identity.** `key` changes when the
 *    media changes (a different track, or local instead of stream). A renewed
 *    token gives a new `url` under the same `key`, so refreshing it does not
 *    reload the element and lose the listener's place.
 */

export type PlayerSource = {
  /**
   * Identity of the media currently resolved. The player reloads the element
   * when this changes, and only then.
   */
  key: string;
  /**
   * Which media that is, before the local/stream distinction. Two resolutions
   * with the same `sourceKey` can share one loaded file; two with different
   * ones cannot.
   */
  sourceKey: string;
  /** A URL that the media element can load. Never empty. */
  url: string;
  /** True when `url` points at the downloaded copy on this device. */
  local: boolean;
};

export type UsePlayerSourceOptions = {
  bookId: number;
  /** The media the current listening position needs. */
  source: PlaybackSource | null;
  /** Resolve a downloaded track to a playable URL, if this device has one. */
  localUrlForTrack?: (bookId: number, trackId: number, serverId?: string) => Promise<string | undefined>;
  /**
   * Spec 30: the server shelf this book belongs to, when it came from the
   * device's offline library. The local copy lives in that shelf's folder, so
   * resolution has to ask the shelf, not merely "the server we are pointed at".
   * Absent for books that came from the connected server's catalogue, which
   * belong to it by construction.
   */
  serverId?: string;
};

export type PlayerSourceState = {
  resolved: PlayerSource | null;
  /** Number of times a fresh media token has been requested. */
  attempt: number;
  /**
   * The downloaded file would not load. Stop offering it for this source and
   * stream instead -- a missing file must not make the book unplayable.
   */
  markLocalFailed: () => void;
  /** The stream failed. Ask for a fresh media token, once. */
  retry: () => void;
};

/**
 * How long to wait for a media token before streaming without one.
 *
 * A token is signed locally, so it is a millisecond operation on a working
 * connection. Waiting for the full request deadline instead would leave the
 * player silent for half a minute on a flaky link, which is worse than trying
 * a URL that may 401 -- a refusal arrives in milliseconds and can be retried.
 */
const TOKEN_TIMEOUT_MS = 5000;

function remoteKind(kind: PlaybackSource["kind"]): MediaResourceKind {
  return kind === "track" ? "track-stream" : "book-stream";
}

/** `promise`, or a rejection if it takes too long. Clears the timer either way. */
async function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timed out")), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * The stream URL, preferring one carrying a media token.
 *
 * `mediaAssetUrl` needs the session token to mint one, which the Android shell
 * keeps in memory rather than in a cookie. A browser gets the plain URL back
 * immediately, so this costs nothing outside the shell.
 */
async function resolveRemote(source: PlaybackSource): Promise<string> {
  const plain = apiUrl(source.path);
  if (!plain) return source.path;
  try {
    const tokenUrl = await within(
      mediaAssetUrl(source.path, remoteKind(source.kind), source.id),
      TOKEN_TIMEOUT_MS,
    );
    return tokenUrl || plain;
  } catch {
    // The token is an optimisation for the shell, not a requirement of the
    // player. Fall back rather than refusing to play.
    return plain;
  }
}

export function usePlayerSource({
  bookId,
  source,
  localUrlForTrack,
  serverId,
}: UsePlayerSourceOptions): PlayerSourceState {
  const [resolved, setResolved] = useState<PlayerSource | null>(null);
  const [attempt, setAttempt] = useState(0);
  // The source whose downloaded file failed to load. Keyed by source so a
  // failure on one track does not stop the next track's local file being used.
  const [failedLocal, setFailedLocal] = useState<string | null>(null);

  // Held in refs so the effect below can depend on the *identity* of the
  // resolver (which changes when the device library reloads) without treating
  // every render's new object as a reason to resolve again.
  const localFnRef = useRef(localUrlForTrack);
  localFnRef.current = localUrlForTrack;
  const sourceRef = useRef<PlaybackSource | null>(source);
  sourceRef.current = source;

  useEffect(() => {
    let cancelled = false;
    if (!source) {
      setResolved(null);
      return () => { cancelled = true; };
    }

    const { key, localTrackId } = source;
    const skipLocal = failedLocal === key || localFnRef.current === undefined || localTrackId === undefined;

    void (async () => {
      if (!skipLocal) {
        try {
          const local = await localFnRef.current?.(bookId, localTrackId as number, serverId);
          if (cancelled) return;
          if (local) {
            setResolved({ key: `${key}|local`, sourceKey: key, url: local, local: true });
            return;
          }
        } catch {
          // An unreadable file is "not downloaded" as far as playback goes.
          // Fall through and stream; `markLocalFailed` covers the case where
          // the URL exists but the element refuses it.
        }
        if (cancelled) return;
      }

      const url = await resolveRemote(source);
      if (cancelled) return;
      setResolved((previous) => {
        const nextKey = `${key}|stream`;
        // Keep the object identity when nothing actually changed: `url` is a
        // dependency of the player's load guard, and a re-resolve that lands
        // on the same URL must not look like a reason to reload.
        if (previous && previous.key === nextKey && previous.url === url) return previous;
        return { key: nextKey, sourceKey: key, url, local: false };
      });
    })();

    return () => { cancelled = true; };
    // The `source` object is rebuilt on every position tick by `planPosition`,
    // so depend on its fields, not on the object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, source?.key, source?.path, source?.id, source?.kind, source?.localTrackId, localUrlForTrack, serverId, failedLocal, attempt]);

  const markLocalFailed = useCallback(() => {
    const current = sourceRef.current;
    if (!current) return;
    setFailedLocal(current.key);
  }, []);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  return { resolved, attempt, markLocalFailed, retry };
}
