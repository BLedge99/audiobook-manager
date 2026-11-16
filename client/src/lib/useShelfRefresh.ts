/**
 * Progress saved while a book was open has to reach the library grid, which
 * otherwise keeps the `progress` it fetched at page load. One effect owns all
 * the shelf's refresh triggers; the rules live in `lib/refreshPolicy.ts`, so
 * they are testable without the App. Extracted from App.tsx (spec 43 phase
 * 6.2); behaviour unchanged.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { refreshTriggered, type RefreshTrigger } from "./refreshPolicy";

/** Window focus and visibilitychange both fire on every alt-tab; collapse them. */
const BACKGROUND_REFRESH_MIN_MS = 30_000;

export interface ShelfRefreshInput {
  profileId: string | null;
  serverReachable: boolean | undefined;
  /** Coalesced library refetch (spec 15b). */
  refresh: () => Promise<void>;
  /** ETag-invalidating refetch after a profile switch. */
  refreshForProfile: () => Promise<void>;
}

export function useShelfRefresh({
  profileId,
  serverReachable,
  refresh,
  refreshForProfile,
}: ShelfRefreshInput) {
  const [libraryTick, setLibraryTick] = useState(0);
  const wasOffline = useRef(false);
  const lastProfileIdRef = useRef<string | null>(null);
  const lastBackgroundRefresh = useRef(0);

  /** Player's final-save hook: refetch *after* the write, not racing it. */
  const bumpLibraryTick = useCallback(() => setLibraryTick((tick) => tick + 1), []);

  useEffect(() => {
    const ask = (trigger: RefreshTrigger) => {
      if (!refreshTriggered(trigger)) return;
      switch (trigger.kind) {
        case "library-tick":
          void refresh();
          return;
        case "server-recovered":
          void refresh();
          return;
        case "window-focus":
        case "visibility-visible": {
          if (!profileId) return;
          const now = Date.now();
          if (now - lastBackgroundRefresh.current < BACKGROUND_REFRESH_MIN_MS) return;
          lastBackgroundRefresh.current = now;
          void refresh();
          return;
        }
        case "profile-changed":
          if (profileId) void refreshForProfile();
          return;
      }
    };

    // What the current state says is owed.
    const owed: RefreshTrigger[] = [];
    if (libraryTick > 0) owed.push({ kind: "library-tick", tick: libraryTick });
    const profileChanged = profileId !== null && profileId !== lastProfileIdRef.current;
    lastProfileIdRef.current = profileId;
    if (profileId && profileChanged) owed.push({ kind: "profile-changed", profileId });
    if (serverReachable === true && wasOffline.current) {
      wasOffline.current = false;
      owed.push({ kind: "server-recovered" });
    }
    if (serverReachable === false) wasOffline.current = true;
    for (const trigger of owed) ask(trigger);

    // Events the shelf cannot see from state: window focus and visibility.
    const onWindowFocus = () => ask({ kind: "window-focus" });
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      ask({ kind: "visibility-visible", becameVisible: true });
    };
    window.addEventListener("focus", onWindowFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onWindowFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [libraryTick, profileId, serverReachable, refresh, refreshForProfile]);

  return { libraryTick, bumpLibraryTick };
}
