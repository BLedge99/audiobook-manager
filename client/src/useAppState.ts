import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Compass, Heart, Library, LayoutGrid, Server } from "lucide-react";
import type { Audiobook } from "./types";
import {
  fetchAppConfig,
  fetchSession,
  getActiveProfileId,
  getServerUrl,
  lockLocal,
  onServerUnreachable,
  setActiveProfileId,
  setAccountExperience as setApiAccountExperience,
  setSessionToken,
  type SessionInfo,
} from "./lib/api";
import {
  activeCacheProfileId,
  hasProfileCache,
  listCachedProfileIds,
  offlineCacheState,
} from "./local/privateCache";
import { offlineScreen, type CacheState } from "./lib/offlineGate";
import { biometricVault } from "./lib/biometricVault";
import {
  applyFilters,
  buildGenreShelves,
  buildSeriesShelves,
  filtersFromQuery,
  filtersToQuery,
  type Filters,
} from "./lib/browse";
import { applySearch, searchFromQueryParam, searchToQueryParam } from "./lib/search";
import { isNativeShell } from "./lib/platform";
import { probeServer as probeServerRequest } from "./lib/reachability";
import { warmCoverCache } from "./local/CoverImage";
import { useDeviceLibrary } from "./local/useDeviceLibrary";
import { useBrowse, useDiscover } from "./useBrowse";
import { useLibrary } from "./useLibrary";
import { copy } from "./copy";

export type Tab = "library" | "browse" | "discover" | "favourites" | "server-library";

export const TABS: { id: Tab; label: string; icon: typeof Library }[] = [
  { id: "library", label: copy.tabs.library, icon: Library },
  { id: "browse", label: copy.tabs.browse, icon: LayoutGrid },
  { id: "discover", label: copy.tabs.discover, icon: Compass },
  { id: "favourites", label: copy.tabs.favourites, icon: Heart },
  { id: "server-library", label: copy.tabs.serverLibrary, icon: Server },
];

export function useAppState() {
  /** The server-derived identity (spec 28); null until the probe resolves. */
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [accountExperience, setAccountExperience] = useState<"household" | "demo">("household");
  const canManageLibrary = session?.role === "admin";
  const library = useLibrary(canManageLibrary);
  const {
    audiobooks,
    roots,
    loading,
    refreshing,
    error,
    refresh,
    refreshForProfile,
  } = library;
  const device = useDeviceLibrary(isNativeShell());
  const browse = useBrowse();
  const discover = useDiscover();

  useEffect(() => {
    void warmCoverCache();
  }, []);

  const [selectedBook, setSelectedBook] = useState<Audiobook>();
  const [authed, setAuthed] = useState<boolean>();
  const [showServerSetup, setShowServerSetup] = useState(false);
  const [bypassServerSetup, setBypassServerSetup] = useState(false);
  const [serverReachable, setServerReachable] = useState<boolean>();
  const [profileId, setProfileId] = useState<string | null>(() => getActiveProfileId());

  const activeProfileId = accountExperience === "demo"
    ? (session?.profile?.id ? String(session.profile.id) : null)
    : session?.profile?.id ? String(session.profile.id) : profileId;

  const playerProfileId = accountExperience === "demo"
    ? (session?.profile ? "demo-account" : null)
    : activeProfileId;

  const probeInFlight = useRef(false);
  const [cacheState, setCacheState] = useState<CacheState>("unknown");
  const [skippedUnlock, setSkippedUnlock] = useState(false);
  const [offlineUnlocked, setOfflineUnlocked] = useState<boolean>(() => {
    const id = Number(window.localStorage.getItem("profileId"));
    return Number.isInteger(id) && id > 0 && activeCacheProfileId() === id;
  });

  const [filters, setFilters] = useState<Filters>(() => filtersFromQuery(window.location.search));
  const [search, setSearch] = useState<string>(() =>
    searchFromQueryParam(new URLSearchParams(window.location.search).get("q")),
  );
  const [tab, setTab] = useState<Tab>(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    return TABS.some((entry) => entry.id === requested) ? (requested as Tab) : "library";
  });

  const probeServer = useCallback(async (): Promise<void> => {
    if (probeInFlight.current) return;
    probeInFlight.current = true;
    try {
      const config = await fetchAppConfig();
      setAccountExperience(config.accountExperience);
      setApiAccountExperience(config.accountExperience);
      const probe = await probeServerRequest();
      setServerReachable(probe.reachable);
      if (probe.reachable) {
        setBypassServerSetup(false);
      }
      if (!probe.reachable) {
        setAuthed(false);
        setProfileId(accountExperience === "demo" ? null : getActiveProfileId());
        return;
      }
      if (!probe.authed) {
        setAuthed(false);
        setSession(null);
        setSessionToken(null);
        setActiveProfileId(null);
        setProfileId(null);
        return;
      }

      const info = await fetchSession();
      if (!info) {
        setAuthed(false);
        setSession(null);
        setSessionToken(null);
        return;
      }
      setSession(info);
      setAuthed(true);
      if (config.accountExperience === "demo") {
        setProfileId(null);
        setActiveProfileId(null);
        if (info.profile) {
          setSession({ ...info, profile: { email: info.profile.email }, role: "member" });
        }
      } else if (info.profile) {
        const id = String(info.profile.id);
        setProfileId(id);
        setActiveProfileId(id);
      } else if (info.via === "household") {
        setProfileId(accountExperience === "demo" ? null : getActiveProfileId());
      }
    } catch (error) {
      console.error("Could not complete server probe.", error);
      setServerReachable(false);
      setAuthed(false);
      setProfileId(accountExperience === "demo" ? null : getActiveProfileId());
    } finally {
      probeInFlight.current = false;
    }
  }, [accountExperience]);

  useEffect(() => {
    probeServer();
  }, [probeServer]);

  const refreshEverything = useCallback(() => {
    if (serverReachable === false) probeServer();
    void refresh();
  }, [serverReachable, probeServer, refresh]);

  useEffect(
    () =>
      onServerUnreachable(() => {
        probeServer();
      }),
    [probeServer],
  );

  useEffect(() => {
    if (!isNativeShell()) return;
    let hiddenAt: number | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const lock = () => {
      void lockLocal();
      setOfflineUnlocked(false);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        timer = setTimeout(lock, 5 * 60 * 1000);
      } else if (hiddenAt !== null) {
        if (Date.now() - hiddenAt >= 5 * 60 * 1000) lock();
        else if (timer) clearTimeout(timer);
        hiddenAt = null;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer) clearTimeout(timer);
    };
  }, []);

  const syncUrl = useCallback((nextTab: Tab, nextFilters: Filters, nextSearch: string) => {
    const params = new URLSearchParams();
    if (nextTab !== "library") params.set("tab", nextTab);
    const filterQuery = filtersToQuery(nextFilters);
    if (filterQuery) params.set("f", filterQuery);
    const searchParam = searchToQueryParam(nextSearch);
    if (searchParam) params.set("q", searchParam);
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, []);

  const onFiltersChange = useCallback((next: Filters) => {
    setFilters(next);
    syncUrl(tab, next, search);
  }, [syncUrl, tab, search]);

  const onSearchChange = useCallback((next: string) => {
    setSearch(next);
    syncUrl(tab, filters, next);
  }, [syncUrl, tab, filters]);

  const [showSettings, setShowSettings] = useState(false);

  const offline = serverReachable === false;
  const libraryBooks = useMemo(() => {
    const books = new Map<string, Audiobook>();
    if (!offline) {
      for (const book of audiobooks) books.set(`${getServerUrl()}#${book.id}`, book);
    }
    for (const book of device.books) {
      const key = `${book.serverId ?? getServerUrl()}#${book.id}`;
      if (!books.has(key)) books.set(key, book);
    }
    return [...books.values()];
  }, [offline, audiobooks, device.books]);

  const favouriteIds = useMemo(() => new Set(browse.favourites), [browse.favourites]);
  const filteredBooks = useMemo(
    () => applySearch(applyFilters(libraryBooks, filters), search),
    [libraryBooks, filters, search],
  );
  const searchedBooks = useMemo(() => applySearch(libraryBooks, search), [libraryBooks, search]);
  const favouriteBooks = useMemo(
    () => libraryBooks.filter((book) => favouriteIds.has(book.id)),
    [libraryBooks, favouriteIds],
  );

  const reviewIds = useMemo(
    () => new Set((browse.reviewQueue ?? []).map((book) => book.id)),
    [browse.reviewQueue],
  );

  const genreLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const parent of browse.genres) {
      map.set(parent.slug, parent.name);
      for (const child of parent.children ?? []) map.set(child.slug, child.name);
    }
    return map;
  }, [browse.genres]);

  const genreShelves = useMemo(
    () => buildGenreShelves(filteredBooks, { labels: { genres: genreLabels } }),
    [filteredBooks, genreLabels],
  );
  const seriesShelves = useMemo(() => buildSeriesShelves(filteredBooks), [filteredBooks]);

  const findSimilar = useCallback((bookId: number) => {
    setSelectedBook(undefined);
    setTab("discover");
    void discover.loadSimilar(bookId);
  }, [discover]);

  const openTab = useCallback(
    (next: Tab) => {
      setTab(next);
      syncUrl(next, filters, search);
      if (next === "favourites" || next === "browse") void browse.refresh();
    },
    [browse, syncUrl, filters, search],
  );

  const toggleFavourite = useCallback((bookId: number) => {
    void browse.toggleFavourite(bookId);
  }, [browse]);

  const gridProps = {
    onSelect: setSelectedBook,
    favourites: favouriteIds,
    onToggleFavourite: toggleFavourite,
    onFindSimilar: (book: Audiobook) => findSimilar(book.id),
    changedIds: reviewIds,
  };

  const [libraryTick, setLibraryTick] = useState(0);
  useEffect(() => {
    if (!libraryTick) return;
    void refresh();
  }, [libraryTick, refresh]);

  useEffect(() => {
    if (!profileId) return;
    void refreshForProfile();
  }, [profileId, refreshForProfile]);

  useEffect(() => {
    if (!profileId) return;
    const refetch = () => { void refresh(); };
    window.addEventListener("focus", refetch);
    const onVisible = () => { if (document.visibilityState === "visible") refetch(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", refetch);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [profileId, refresh]);

  const wasOffline = useRef(false);
  useEffect(() => {
    if (serverReachable === false) {
      wasOffline.current = true;
      return;
    }
    if (serverReachable !== true) return;
    if (!wasOffline.current) return;
    wasOffline.current = false;
    void refresh();
  }, [serverReachable, refresh]);

  useEffect(() => {
    const recheck = () => {
      if (serverReachable === false) probeServer();
    };
    window.addEventListener("focus", recheck);
    const onVisible = () => { if (document.visibilityState === "visible") recheck(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [serverReachable, probeServer]);

  useEffect(() => {
    if (activeProfileId) return;
    let alive = true;
    void listCachedProfileIds().then((ids) => {
      if (!alive) return;
      if (ids.length === 1) {
        const id = String(ids[0]);
        setActiveProfileId(id);
        setProfileId(id);
      }
    });
    return () => {
      alive = false;
    };
  }, [activeProfileId]);

  useEffect(() => {
    if (serverReachable !== false || !activeProfileId) {
      setCacheState("unknown");
      return;
    }
    const id = Number(activeProfileId);
    if (!Number.isInteger(id) || id < 1) {
      setCacheState("absent");
      setOfflineUnlocked(false);
      return;
    }
    if (activeCacheProfileId() === id) {
      setCacheState("present");
      setOfflineUnlocked(true);
      return;
    }

    let alive = true;
    void Promise.all([
      hasProfileCache(id),
      biometricVault.hasSavedValue(id).catch(() => false),
    ]).then(([hasEnvelope, vaultSaved]) => {
      if (!alive) return;
      setCacheState(offlineCacheState(hasEnvelope, vaultSaved));
      setOfflineUnlocked(false);
    });
    return () => {
      alive = false;
    };
  }, [serverReachable, activeProfileId]);

  useEffect(() => {
    if (serverReachable !== false) setSkippedUnlock(false);
  }, [serverReachable]);

  useEffect(() => {
    setSkippedUnlock(false);
  }, [activeProfileId]);

  const handleContinueOffline = useCallback(() => {
    setShowServerSetup(false);
    setBypassServerSetup(true);
    setServerReachable(false);
  }, []);

  const openServerSetup = useCallback(() => {
    setShowServerSetup(true);
    setBypassServerSetup(false);
  }, []);

  const retryOffline = useCallback(() => {
    probeServer();
    void device.refresh();
  }, [probeServer, device.refresh]);

  const [recovering, setRecovering] = useState(false);
  const [recoverMessage, setRecoverMessage] = useState<string>();
  const recoverDownloads = useCallback(async () => {
    setRecovering(true);
    setRecoverMessage(undefined);
    try {
      const result = await device.recover();
      setRecoverMessage(
        result.recovered.length > 0
          ? copy.offline.unclaimedRestored(result.recovered.length)
          : result.unreadable.length > 0
            ? copy.offline.recoverFailed
            : copy.offline.unclaimedNothing,
      );
    } catch {
      setRecoverMessage(copy.offline.recoverFailed);
    } finally {
      setRecovering(false);
    }
  }, [device.recover]);

  const screen = offline
    ? offlineScreen({
        deviceLoading: device.loading,
        booksOnDevice: device.books.length,
        libraryReadError: device.libraryReadError,
        hasProfile: Boolean(activeProfileId),
        cache: cacheState,
        unlocked: offlineUnlocked,
        skippedUnlock,
      })
    : null;

  const progressAvailable =
    !offline || (screen?.kind === "shell" ? screen.progressAvailable : false);
  const visibleTabs = offline ? TABS.filter((entry) => entry.id === "library") : TABS;
  const shownTab: Tab = offline ? "library" : tab;

  return {
    session,
    setSession,
    accountExperience,
    setAccountExperience,
    canManageLibrary,
    library,
    roots,
    loading,
    refreshing,
    error,
    refresh,
    device,
    browse,
    discover,
    selectedBook,
    setSelectedBook,
    authed,
    setAuthed,
    showServerSetup,
    setShowServerSetup,
    bypassServerSetup,
    serverReachable,
    profileId,
    setProfileId,
    activeProfileId,
    playerProfileId,
    cacheState,
    skippedUnlock,
    setSkippedUnlock,
    offlineUnlocked,
    setOfflineUnlocked,
    filters,
    search,
    tab,
    shownTab,
    visibleTabs,
    offline,
    screen,
    progressAvailable,
    libraryBooks,
    searchedBooks,
    filteredBooks,
    favouriteIds,
    favouriteBooks,
    reviewIds,
    genreShelves,
    seriesShelves,
    findSimilar,
    openTab,
    toggleFavourite,
    onFiltersChange,
    onSearchChange,
    gridProps,
    showSettings,
    setShowSettings,
    setLibraryTick,
    recovering,
    recoverMessage,
    recoverDownloads,
    handleContinueOffline,
    openServerSetup,
    retryOffline,
    refreshEverything,
    probeServer,
  };
}

export type AppState = ReturnType<typeof useAppState>;
