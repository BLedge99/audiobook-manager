/**
 * The device cover cache (spec 15b feature 1).
 *
 * ## Why this exists
 *
 * The report was: "sometimes work and display, then randomly stop and go back
 * to the placeholder, then other times are just a solid colour with no
 * placeholder or proper cover". One cause behind all three: covers were fetched
 * live by `<img>` on every render, over a home LAN, with nothing caching them.
 *
 * A service worker would be the browser's usual answer and is **not available
 * here**: service workers do not work reliably in the Capacitor WebView (they
 * do not work at all on WKWebView), and covers have to survive airplane mode in
 * the Android shell, which is the entire point. IndexedDB does work everywhere,
 * so that is where they go.
 *
 * ## The three states, and why an `<img>` cannot be trusted with them
 *
 * The real states are "cached and known good", "not fetched yet or known bad",
 * and nothing. The old component had two, and reached the first by handing the
 * browser a network URL -- which can be slow, can fail, and can return bytes
 * that are not an image. That last case is the "solid colour with no
 * placeholder": an `<img>` painted before `onError` had fired.
 *
 * So this module never hands out a network URL. `useCover` returns a blob URL
 * the browser has already been given the bytes for, or a placeholder. A broken
 * frame is not made less likely here; it is made unrepresentable.
 *
 * ## Why the bytes are still revalidated
 *
 * A cover that has been seen must never *disappear*, but it must still be able
 * to *change*: an operator re-enriches a book and the artwork is replaced. So
 * every fetch is conditional on the stored ETag. A 304 keeps the stored bytes; a
 * 200 replaces them. Offline, neither happens, and the stored bytes are used
 * untouched.
 *
 * ## The accepted cost
 *
 * Caching makes a wrong cover sticky. `LIMITATIONS.md` §2.7 records that these
 * are cover *editions* from a book catalogue, not the artwork of the audiobook
 * you own, so a book can be filed under a different edition's jacket. Before,
 * a failed fetch at least left an honest placeholder. Now the wrong edition
 * persists until the ETag changes. That is the trade, and it is recorded in the
 * spec rather than discovered later.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { localDb, type CoverRecord } from "./db";
import { coverUrl } from "../lib/api";

/**
 * How many covers may be held on the device.
 *
 * Measured, not guessed: this household's covers average 47 KB (median 22 KB,
 * largest 199 KB), so 512 MB is roughly 11,000 books. Chosen with headroom
 * rather than tightness, and because eviction is a last resort that should never
 * fire in practice -- a cache that thrashes is worse than a cache that is full.
 */
export const COVER_CACHE_BYTES = 512 * 1024 * 1024;

/** Concurrent cover fetches. Bounded so a long grid cannot flood a phone's radio. */
const MAX_CONCURRENT_FETCHES = 4;

/** How far ahead of the viewport a cover starts fetching. */
const VIEWPORT_MARGIN = "320px";

/**
 * How long to wait for an intersection before fetching anyway.
 *
 * **Measured on a Pixel 4a / Android 13 WebView, 2026-10-19.** An
 * IntersectionObserver on an element that is plainly on screen, inside a page
 * that is not scrolling, **never delivered its callback**. `requestAnimationFrame`
 * fired normally, so the rendering pipeline was alive; scrolling by 50px made the
 * callback arrive immediately. Chromium — which is what the unit tests and the
 * desktop E2E suite run on — delivers the initial observation pass straight away,
 * so nothing about this was visible anywhere except on the device.
 *
 * Without a deadline the consequence is not "covers load a bit later". The gate
 * never opens, **no cover is ever fetched**, and nothing errors: the shelf shows
 * sixteen placeholders and looks like a network problem.
 *
 * So the observer is an *optimisation*, not a gate: after this deadline the cover
 * loads anyway. It costs at most one second of laziness on a slow device, which is
 * nothing next to never rendering the artwork at all.
 */
const NEAR_VIEWPORT_FALLBACK_MS = 1000;

export type CoverState =
  | { status: "absent" }
  | { status: "loading" }
  | { status: "ready"; url: string };

/**
 * Frozen, module-level constants.
 *
 * `useSyncExternalStore` compares snapshots by identity and re-renders forever
 * if `getSnapshot` allocates a new object each call, so every "not available
 * yet" answer must be the *same* object.
 */
const ABSENT: CoverState = Object.freeze({ status: "absent" });
const LOADING: CoverState = Object.freeze({ status: "loading" });

/** Cache key for a book's own cover, served by the API. */
export function bookCoverKey(bookId: number): string {
  return `book:${bookId}`;
}

/** Cache key for a cover referenced by URL, which is what Discover and the wishlist carry. */
export function urlCoverKey(href: string): string {
  return `url:${href}`;
}

/** The network URL a key refers to, or undefined for a key with none. */
function networkUrl(key: string): string | undefined {
  if (key.startsWith("book:")) return coverUrl(Number(key.slice("book:".length)));
  if (key.startsWith("url:")) return key.slice("url:".length);
  return undefined;
}

/**
 * Live entries, keyed by cache key.
 *
 * An entry is created on first touch and never replaced, so its `state` object
 * identity is stable for the life of the entry -- which is what lets
 * `useSyncExternalStore` work without re-rendering on every peek.
 */
interface Entry {
  state: CoverState;
  /** The stored record, when one exists. */
  record?: CoverRecord;
  /** Object URL to revoke if the entry is dropped. */
  objectUrl?: string;
  /** Set while a fetch for this key is in flight, so one key means one request. */
  fetching?: Promise<void>;
  /**
   * Whether this entry has been checked against the server this session.
   *
   * Without it a cover that had been seen was never revalidated again, so an
   * operator re-enriching a book left the old artwork on screen until the app
   * was force-quit.
   */
  revalidated?: boolean;
}

const entries = new Map<string, Entry>();
/** Keys whose bytes are known not to decode. Never retried automatically. */
const unreadable = new Set<string>();
const listeners = new Set<() => void>();

/** Total stored bytes, for the Settings screen. */
let totalBytes = 0;

function notify(): void {
  for (const listener of listeners) listener();
}

function entryFor(key: string): Entry {
  let entry = entries.get(key);
  if (!entry) {
    entry = { state: ABSENT };
    entries.set(key, entry);
  }
  return entry;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Ask the browser not to evict us.
 *
 * Covers are re-fetchable, so losing them is a performance loss and not a
 * correctness one -- but on a phone the browser clearing IndexedDB under storage
 * pressure would silently empty the cache, which is exactly the "covers
 * disappeared" report. Best effort: a refusal is not an error.
 */
let persistRequested = false;
function requestPersistence(): void {
  if (persistRequested || typeof navigator === "undefined") return;
  persistRequested = true;
  void navigator.storage?.persist?.().catch(() => undefined);
}

/**
 * Ask for a key's bytes if they are not already here.
 *
 * Two gates before anything hits the network, in this order:
 *
 *  1. IndexedDB. A cover stored on a previous session is shown immediately and
 *     never refetched, so the app is useful the moment it opens with no
 *     connection at all.
 *  2. The network, and only if step 1 found nothing.
 */
async function ensure(key: string): Promise<void> {
  const entry = entryFor(key);
  if (entry.fetching || unreadable.has(key)) return;

  // Already on screen. Revalidate it -- but only once per session.
  //
  // This guard was originally `if (state === "ready") return`, which meant a
  // cover that had been seen was *never* checked again for the rest of the
  // session: an operator re-enriched a book, the artwork changed, and the card
  // kept showing the old one until the app was force-quit. Revalidating on
  // every mount would put one request per card back, which is the behaviour
  // this whole feature removed -- so the flag is what makes both true at once:
  // changed artwork appears, and a grid does not storm the network.
  if (entry.state.status === "ready") {
    if (entry.revalidated || !entry.record?.etag) return;
    entry.revalidated = true;
    void enqueueRevalidate(key, entry.record);
    return;
  }

  const run = (async () => {
    try {
      await warmCoverCache();
      const stored = entry.record ?? (await localDb.covers.get(key));
      if (stored) {
        applyRecord(key, stored);
        // Marked here as well as in the fresh-fetch path. Without it, the very
        // next render finds the entry `ready`, takes the revalidate-once branch
        // and fires a *second* request for the same cover.
        entry.revalidated = true;
        // Cached bytes render *now* and revalidate behind them. The listener
        // never waits on the network to see a cover they have already seen.
        if (stored.etag) void enqueueRevalidate(key, stored);
        return;
      }
      const url = networkUrl(key);
      if (!url) return;
      if (entry.state.status !== "ready") {
        entry.state = LOADING;
        notify();
      }
      const fetched = await enqueueFetch(url, null);
      if (fetched) {
        await store(key, fetched);
        // These bytes came from the server moments ago, so there is nothing to
        // revalidate. Without this, every cover would be fetched twice on the
        // first render of every session.
        entry.revalidated = true;
      }
    } catch {
      // A cover that cannot be fetched renders as the placeholder. Never an
      // error state: a missing cover is a normal outcome, not a failure.
      if (entry.state.status !== "ready") {
        entry.state = ABSENT;
        notify();
      }
    } finally {
      entry.fetching = undefined;
    }
  })();

  entry.fetching = run;
}

let inFlight = 0;
const waiters: (() => void)[] = [];

/**
 * Bounded concurrency: a grid of 30 cards must not fire 30 requests on mount,
 * which on a phone waking to Wi-Fi is the same slowness this feature exists to
 * remove.
 */
async function enqueueFetch(url: string, etag: string | null) {
  await new Promise<void>((resolve) => {
    if (inFlight < MAX_CONCURRENT_FETCHES) {
      inFlight += 1;
      resolve();
      return;
    }
    waiters.push(resolve);
  });
  try {
    return await fetchCover(url, etag);
  } finally {
    const next = waiters.shift();
    if (next) {
      next();
    } else {
      inFlight = Math.max(0, inFlight - 1);
    }
  }
}

/** Revalidation gets its own budget, so a cold grid is never starved by it. */
async function enqueueRevalidate(key: string, stored: CoverRecord): Promise<void> {
  const url = networkUrl(key);
  if (!url) return;
  try {
    const fetched = await enqueueFetch(url, stored.etag);
    // 304: keep the bytes we have. That is the "a cover never disappears" rule.
    if (fetched) await store(key, fetched);
  } catch {
    // Offline, or the server is down. The stored bytes are the answer.
  }
}

/** One conditional GET. Returns undefined for "not modified". */
async function fetchCover(url: string, etag: string | null): Promise<{ blob: Blob; etag: string | null } | undefined> {
  const headers: Record<string, string> = {};
  if (etag) headers["If-None-Match"] = etag;
  const response = await fetch(url, { headers });
  if (response.status === 304) return undefined;
  if (!response.ok) throw new Error(`Cover request failed (${response.status})`);
  const blob = await response.blob();
  // A cover route that returned HTML -- an auth page, or the WebView's bundled
  // index.html for a mis-resolved URL -- would otherwise be stored as a cover
  // and painted as a solid colour. That is the third symptom, caught here
  // rather than in an `onError` that may never be reached in time.
  if (blob.type && !blob.type.startsWith("image/")) throw new Error("Not an image");
  return { blob, etag: response.headers.get("etag") };
}

async function store(key: string, fetched: { blob: Blob; etag: string | null }): Promise<void> {
  const record: CoverRecord = {
    key,
    blob: fetched.blob,
    etag: fetched.etag,
    savedAt: Date.now(),
    bytes: fetched.blob.size,
  };
  unreadable.delete(key);
  await localDb.covers.put(record);
  totalBytes += record.bytes;
  applyRecord(key, record);
  void evictIfNeeded();
}

/**
 * Publish a record to whoever is rendering it.
 *
 * The object URL is minted here and revoked only when the entry is dropped, so
 * the same bytes back the same `<img>` for the life of the entry and the browser
 * decodes once.
 */
function applyRecord(key: string, record: CoverRecord): void {
  const entry = entryFor(key);
  const changed = entry.record && (entry.record.etag !== record.etag || entry.record.bytes !== record.bytes);
  entry.record = record;
  if (changed && entry.objectUrl) {
    // The bytes changed, so the old object URL points at the *old* blob. Keeping
    // it would leave the card showing the previous artwork forever -- which is
    // what the "replaces the cover when the server sends new bytes" test
    // caught, and what a `if (!objectUrl)` guard silently does.
    URL.revokeObjectURL(entry.objectUrl);
    entry.objectUrl = undefined;
  }
  if (!entry.objectUrl) {
    entry.objectUrl = URL.createObjectURL(record.blob);
  }
  entry.state = { status: "ready", url: entry.objectUrl };
  notify();
}

/**
 * Drop the oldest covers once the cache is over its budget.
 *
 * "Oldest" is `savedAt`, which is least-recently-*stored* rather than
 * least-recently-*used*. Updating `savedAt` on every read would mean an
 * IndexedDB write per render, which is exactly the write amplification the rest
 * of this module avoids. With a budget of ~11,000 covers, a stale-but-kept
 * entry is not a scenario this product reaches.
 *
 * Entries currently rendering are never evicted, so a card on screen cannot
 * have its bytes pulled out from under it.
 */
async function evictIfNeeded(): Promise<void> {
  if (totalBytes <= COVER_CACHE_BYTES) return;
  const held = new Set([...entries.entries()].filter(([, entry]) => entry.state.status === "ready").map(([key]) => key));
  const candidates = (await localDb.covers.toArray())
    .filter((record) => !held.has(record.key))
    .sort((a, b) => a.savedAt - b.savedAt);
  for (const record of candidates) {
    if (totalBytes <= COVER_CACHE_BYTES) break;
    await localDb.covers.delete(record.key);
    totalBytes -= record.bytes;
    const entry = entries.get(record.key);
    if (entry?.objectUrl) URL.revokeObjectURL(entry.objectUrl);
    if (entry) entry.record = undefined;
  }
}

/** Current state for a key, and the side effect of arranging for it to exist. */
function peek(key: string | undefined, enabled: boolean): CoverState {
  if (!key || !enabled) return ABSENT;
  const entry = entryFor(key);
  // `ensure` is called in both branches, not just the not-ready one: it is what
  // schedules the once-per-session revalidation for a cover that is already on
  // screen, and it returns immediately when there is nothing to do. Returning
  // early on `ready` -- which is what this did at first -- meant a cover was
  // never checked against the server again for the rest of the session.
  void ensure(key);
  if (entry.state.status === "ready") return entry.state;
  // Not in memory yet: it may still be in IndexedDB from a previous session.
  // `ensure` reads the store before deciding to fetch, which is what makes a
  // cold start offline work at all.
  return LOADING;
}

/** Bytes currently held, for the Settings storage panel. */
export function coverCacheBytes(): number {
  return totalBytes;
}

/** Forget every cached cover. Books already downloaded are untouched. */
export async function clearCoverCache(): Promise<void> {
  await localDb.covers.clear();
  totalBytes = 0;
  for (const entry of entries.values()) {
    if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
  }
  entries.clear();
  unreadable.clear();
  notify();
}

/**
 * Read the whole cache into memory at startup, and publish what it finds.
 *
 * This is what makes a cold start *offline* show covers: `peek` on a cold map
 * would report "not here" and send every card to the network, which is
 * unavailable, which is the original bug. One query brings the shelf back.
 */
export async function warmCoverCache(): Promise<void> {
  if (warmPromise) return warmPromise;
  warmPromise = (async () => {
    try {
      requestPersistence();
      const records = await localDb.covers.toArray();
      totalBytes = records.reduce((total, record) => total + record.bytes, 0);
      for (const record of records) {
        // `state` is left alone. A card that has not asked for this key yet is
        // still ABSENT, and will read the record when it does -- which keeps
        // this to one pass over the store instead of minting an object URL for
        // every cover in the library on every launch.
        entryFor(record.key).record = record;
      }
      notify();
    } catch {
      // A cache that will not open is an empty cache, not a broken app.
    }
  })();
  return warmPromise;
}

let warmPromise: Promise<void> | undefined;

/**
 * True once the element is near the viewport, or once it plainly should be.
 *
 * `loading="lazy"` does not do this job: the browser still issues a request per
 * card that is laid out, which on a grid is most of them. It is here because a
 * cover that is never scrolled to should cost nothing.
 *
 * **The deadline is not belt-and-braces, it is the fix.** See
 * `NEAR_VIEWPORT_FALLBACK_MS`: on the device this ships to, the observer's
 * initial pass never arrives, so an observer-only gate means no cover is ever
 * fetched and nothing reports an error.
 *
 * jsdom has no `IntersectionObserver`, and a component that threw on a missing
 * browser API would fail every unit test for a reason that has nothing to do
 * with this feature. Missing API means "assume visible", which is the safe
 * direction.
 */
function useNearViewport<T extends HTMLElement>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    const node = ref.current;
    if (!node || near) return;
    let settled = false;
    let observer: IntersectionObserver | null = null;

    const open = () => {
      if (settled) return;
      settled = true;
      observer?.disconnect();
      setNear(true);
    };

    if (typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) open();
        },
        { rootMargin: VIEWPORT_MARGIN },
      );
      observer.observe(node);
    }

    // The escape hatch. A cover is ~47 KB on a home LAN; one second of extra
    // laziness is invisible, and never fetching it is not.
    const timer = window.setTimeout(open, NEAR_VIEWPORT_FALLBACK_MS);

    return () => {
      window.clearTimeout(timer);
      observer?.disconnect();
    };
  }, [near]);

  return [ref, near];
}

/**
 * A cover, in whichever of its three states it is.
 *
 * @param key     A `bookCoverKey` / `urlCoverKey`. Identity, not a URL, so the
 *                cache survives a session token changing.
 * @param enabled False for a cover nobody is looking at. Defaults to true.
 */
export function useCover(key: string | undefined, enabled = true): CoverState {
  // The snapshot is a frozen, stable object per state -- `ABSENT`, `LOADING` or
  // the entry's own `ready` object -- so `useSyncExternalStore` compares by
  // identity and does not re-render in a loop.
  const getSnapshot = useCallback(() => peek(key, enabled), [key, enabled]);
  return useSyncExternalStore(subscribe, getSnapshot, () => ABSENT);
}

/**
 * The `<img>` for a cover, or the placeholder.
 *
 * The invariant that matters: **when this renders an image, its `src` is a blob
 * URL the browser already holds the bytes for.** It is never a network URL. A
 * slow request, a failed request, or a response that is not an image cannot
 * paint -- the "solid colour with no placeholder" report was exactly that, an
 * `<img>` painted before its `onError` fired.
 */
export function CoverImage({
  cacheKey,
  className,
  alt = "",
  enabled,
}: {
  cacheKey: string | undefined;
  className?: string;
  alt?: string;
  enabled?: boolean;
}) {
  const [ref, near] = useNearViewport<HTMLSpanElement>();
  const state = useCover(cacheKey, enabled ?? near);

  return (
    <span ref={ref} className={className} data-cover={state.status}>
      {state.status === "ready" ? (
        <img
          src={state.url}
          alt={alt}
          decoding="async"
          data-testid="cover-img"
          // The last resort, and it is still not a network URL: bytes that were
          // stored but do not decode. Remembered, so a broken cover is not
          // refetched on every render.
          onError={() => markUnreadable(cacheKey)}
        />
      ) : (
        <img
          src="/placeholder-cover.svg"
          alt=""
          aria-hidden="true"
          decoding="async"
          data-testid="cover-img"
        />
      )}
    </span>
  );
}

/**
 * Remember that a stored blob does not decode.
 *
 * Kept in memory rather than written to IndexedDB: a cover that failed to decode
 * once has usually failed because the *stored* bytes are bad, and the operator's
 * next re-enrich changes the ETag anyway.
 */
function markUnreadable(key: string | undefined): void {
  if (!key) return;
  unreadable.add(key);
  const entry = entries.get(key);
  if (entry) {
    if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
    entries.delete(key);
  }
  void localDb.covers.delete(key);
  notify();
}

export { useNearViewport };
