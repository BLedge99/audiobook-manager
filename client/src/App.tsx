import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Compass, FolderPlus, Heart, Library, LayoutGrid, LoaderCircle, RefreshCw, ScanLine, Trash2, WifiOff, Server, Settings as GearIcon } from "lucide-react";
import { AudiobookDetail } from "./components/AudiobookDetail";
import { AudiobookGrid, ContinueListening, inProgressBooks } from "./components/AudiobookGrid";
import { Discover } from "./components/Discover";
import { FilterBar } from "./components/FilterBar";
import {
  needsServerUrl,
  onServerUnreachable,
  fetchSession,
  getActiveProfileId,
  setActiveProfileId,
  setSessionToken,
  lockSession,
  type SessionInfo,
} from "./lib/api";
import { AccountGate } from "./components/AccountGate";
import { OfflineNotice, Splash } from "./components/OfflineNotice";
import { OfflineUnlock } from "./components/OfflineUnlock";
import { activeCacheProfileId, hasProfileCache, listCachedProfileIds, offlineCacheState } from "./local/privateCache";
import { ProfileGate } from "./components/ProfileGate";
import { ServerSetup } from "./components/ServerSetup";
import { ProfileSwitcher } from "./components/ProfileSwitcher";
import { ReviewQueue } from "./components/ReviewQueue";
import { SearchBar } from "./components/SearchBar";
import { ServerLibrary } from "./components/ServerLibrary";
import { Shelves } from "./components/Shelves";
import { TagManager } from "./components/TagManager";
import {
  applyFilters,
  buildGenreShelves,
  buildSeriesShelves,
  filtersFromQuery,
  filtersToQuery,
  isFilterActive,
  type Filters,
} from "./lib/browse";
import { applySearch, searchFromQueryParam, searchToQueryParam } from "./lib/search";
import { isNativeShell } from "./lib/platform";
import { probeServer as probeServerRequest } from "./lib/reachability";
import { biometricVault } from "./lib/biometricVault";
import { clearCoverCache, coverCacheBytes, warmCoverCache } from "./local/CoverImage";
import { useDeviceLibrary } from "./local/useDeviceLibrary";
import { Settings } from "./components/Settings";
import { DownloadButton } from "./components/DownloadButton";
import { useBrowse, useDiscover } from "./useBrowse";
import { useLibrary } from "./useLibrary";
import { copy, plural } from "./copy";
import { Specks, ThemeToggle, Notice, MachineHead, StatusLegend, Btn, IconBtn, cn } from "./ui/primitives";
import type { Audiobook } from "./types";

type Tab = "library" | "browse" | "discover" | "favourites" | "server-library";

const TABS: { id: Tab; label: string; icon: typeof Library }[] = [
  { id: "library", label: copy.tabs.library, icon: Library },
  { id: "browse", label: copy.tabs.browse, icon: LayoutGrid },
  { id: "discover", label: copy.tabs.discover, icon: Compass },
  { id: "favourites", label: copy.tabs.favourites, icon: Heart },
  { id: "server-library", label: copy.tabs.serverLibrary, icon: Server },
];

/**
 * The machine's mark: a canted capsule with a play dome, matching favicon.svg.
 * Inline so it inherits the theme tokens rather than shipping two copies of the
 * same drawing.
 */
function Mark() {
  return (
    <span aria-hidden="true" className="grid size-11 shrink-0 -rotate-6 place-items-center rounded-[15px_12px_15px_12px/12px_15px_12px_15px] border-2 border-ink bg-surface shadow-[0_3px_0_-1px_color-mix(in_srgb,var(--ink)_80%,transparent)]">
      <span className="grid size-7 place-items-center rounded-full border-2 border-ink bg-rasp">
        <span className="h-0 w-0 border-y-[5px] border-l-[8px] border-y-transparent border-l-white" />
      </span>
    </span>
  );
}

function App() {
  /** The server-derived identity (spec 28); null until the probe resolves. */
  const [session, setSession] = useState<SessionInfo | null>(null);
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
    addRoot,
    removeRoot,
    scan,
  } = library;
  const device = useDeviceLibrary(isNativeShell());
  const browse = useBrowse();
  const discover = useDiscover();
  // Read the device cover cache into memory once, before the grid renders its
  // first card (spec 15b feature 1). Without this a cold start asks IndexedDB
  // per cover, and a cold start *offline* would show a shelf of placeholders
  // while each one discovered, one at a time, that it already had the bytes.
  useEffect(() => {
    void warmCoverCache();
  }, []);

  const [selectedBook, setSelectedBook] = useState<Audiobook>();
  const [path, setPath] = useState("");
  const [label, setLabel] = useState("");
  const [showRootForm, setShowRootForm] = useState(false);
  const [working, setWorking] = useState(false);
  const [authed, setAuthed] = useState<boolean>();
  const [showServerSetup, setShowServerSetup] = useState(false);
  const [bypassServerSetup, setBypassServerSetup] = useState(false);
  /**
   * Whether the server answered at all, as distinct from whether it said 401.
   *
   * These were conflated into one `authed` boolean, which meant an unreachable
   * server looked identical to being logged out -- so the app demanded a login it
   * could never complete. Someone who had downloaded a book to listen on a plane
   * was locked out of it by the very feature that let them download it.
   */
  const [serverReachable, setServerReachable] = useState<boolean>();
  const [profileId, setProfileId] = useState<string | null>(() => getActiveProfileId());
  /** The session profile is authoritative; localStorage is the break-glass hint. */
  const activeProfileId = session?.profile ? String(session.profile.id) : profileId;
  /** A probe in flight, so a failing probe cannot trigger another one. */
  const probeInFlight = useRef(false);
  /**
   * Offline cache state (spec 28). `undefined` means "still checking"; `false`
   * means this device has downloads but no envelope, which is a different
   * explanation from "nothing downloaded".
   */
  const [offlineCacheExists, setOfflineCacheExists] = useState<boolean>();
  const [offlineUnlocked, setOfflineUnlocked] = useState<boolean>(() => {
    const id = Number(window.localStorage.getItem("profileId"));
    return Number.isInteger(id) && id > 0 && activeCacheProfileId() === id;
  });
  // Spec 20: both the tab and the filters live in the URL, so a shared or
  // bookmarked link restores the whole view. Persisting filters alone was not
  // enough -- reloading a filtered link landed on the Library tab and looked
  // like the filter had been lost.
  const [filters, setFilters] = useState<Filters>(() => filtersFromQuery(window.location.search));
  // Spec 22: the typed search lives in the URL alongside the chip filters, so a
  // search is as shareable and reload-safe as a filter.
  const [search, setSearch] = useState<string>(() =>
    searchFromQueryParam(new URLSearchParams(window.location.search).get("q")),
  );
  const [tab, setTab] = useState<Tab>(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    return TABS.some((entry) => entry.id === requested) ? (requested as Tab) : "library";
  });

  /**
   * Ask the server who we are.
   *
   * Records two separate facts: did it answer at all, and did it accept us.
   * Re-run on focus so returning home recovers without a manual restart.
   *
   * The probe is **bounded** (see `lib/reachability.ts`): a host that is
   * unreachable but silent never answers, and an unbounded request left the
   * app on the splash for good.
   */
  const probeServer = useCallback(() => {
    // One probe at a time. The probe is itself a request, and a request that
    // fails reports the server as unreachable -- so without this guard a
    // failing probe would trigger another probe, for ever.
    if (probeInFlight.current) return;
    probeInFlight.current = true;
    void probeServerRequest()
      .then(async (probe) => {
        setServerReachable(probe.reachable);
        if (probe.reachable) {
          setBypassServerSetup(false);
        }
        if (!probe.reachable) {
          setAuthed(false);
          // AccountGate can persist a profile immediately before this probe
          // fails. Refresh the in-memory hint so offline sign-in can continue.
          setProfileId(getActiveProfileId());
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
        if (info.profile) {
          const id = String(info.profile.id);
          setProfileId(id);
          setActiveProfileId(id);
        } else if (info.via === "household") {
          setProfileId(getActiveProfileId());
        }
      })
      .finally(() => {
        probeInFlight.current = false;
      });
  }, []);

  useEffect(() => {
    probeServer();
  }, [probeServer]);

  /**
   * The refresh button.
   *
   * When the server is believed to be unreachable, this also re-probes. The
   * person tapping refresh is saying "try again", and the app's own belief
   * about whether the server is there is exactly what is in doubt -- so the
   * button is the one place that settles it.
   */
  const refreshEverything = useCallback(() => {
    if (serverReachable === false) probeServer();
    void refresh();
  }, [serverReachable, probeServer, refresh]);

  /**
   * A request failed because the server could not be reached.
   *
   * The app used to learn this only from a probe, and the probe only ran at
   * startup and when the window regained focus. A phone that lost the server
   * -- unplugged, or pointed at the wrong address -- went on showing the
   * shelf it had loaded, with buttons that looked alive and silently did
   * nothing. The household's report was exactly that: books taken out of the
   * library stayed in it, and pressing refresh did nothing.
   *
   * So a failed request re-probes. The **probe** decides, not the failure:
   * one blip does not take the app offline, and a server that is really gone
   * puts the app into the offline state it should have been in all along.
   */
  useEffect(
    () =>
      onServerUnreachable(() => {
        probeServer();
      }),
    [probeServer],
  );

  // Keep the native shell private when it has been out of view for five
  // minutes. Mobile timers can be throttled in the background, so check the
  // elapsed wall time on return as well as using the timer.
  useEffect(() => {
    if (!isNativeShell()) return;
    let hiddenAt: number | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const lock = () => {
      void lockSession();
      setAuthed(false);
      setSession(null);
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

  /** Write the current view (tab + filters + search) to the URL. */
  const syncUrl = useCallback((nextTab: Tab, nextFilters: Filters, nextSearch: string) => {
    const params = new URLSearchParams();
    if (nextTab !== "library") params.set("tab", nextTab);
    const filterQuery = filtersToQuery(nextFilters);
    if (filterQuery) params.set("f", filterQuery);
    const search = searchToQueryParam(nextSearch);
    if (search) params.set("q", search);
    const query = params.toString();
    // replaceState, not pushState: toggling five chips should not require
    // five presses of the back button.
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

  /**
   * Which books to show.
   *
   * Normally the live server library. But when the server cannot be reached and
   * the device has books, fall back to the replica rather than showing an error
   * over an empty shelf -- being away from home is the case the whole feature
   * exists for, so it must not look like a failure.
   */
  const offline = serverReachable === false && device.books.length > 0;
  const libraryBooks = offline ? device.books : audiobooks;

  const favouriteIds = useMemo(() => new Set(browse.favourites), [browse.favourites]);
  // Search narrows the chip-filtered result rather than replacing it, so both
  // layers apply and neither can widen the other.
  const filteredBooks = useMemo(
    () => applySearch(applyFilters(libraryBooks, filters), search),
    [libraryBooks, filters, search],
  );
  // The Library tab applies the typed search but not the chip filters: the
  // chips only exist on Browse, so applying them here would silently hide
  // books when the user just switched tabs.
  const searchedBooks = useMemo(() => applySearch(libraryBooks, search), [libraryBooks, search]);
  const favouriteBooks = useMemo(
    () => libraryBooks.filter((book) => favouriteIds.has(book.id)),
    [libraryBooks, favouriteIds],
  );

  /**
   * Books waiting on a metadata decision. These keep a mark on their capsule in
   * every grid until someone actually looks at them, rather than blending back
   * into the shelf the moment the tab is re-rendered.
   */
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

  /**
   * Opening a tab refreshes the data that tab depends on. Discover already
   * recomputes on open (spec 19); Favourites and Browse need the same, because
   * a favourite toggled in another tab -- or on another device -- leaves the
   * list fetched at mount stale, and the tab then silently shows nothing.
   */
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

  /**
   * Progress saved while a book was open has to reach the library grid, which
   * otherwise keeps whatever `progress` it fetched at page load. This fires
   * from the player's final save, so the refetch happens *after* the write
   * rather than racing it.
   *
   * Also refetch when the tab is focused or becomes visible again: the same
   * staleness appears when listening happened on another device.
   *
   * A refetch no longer blanks the shelf, so none of these need a "silent"
   * variant any more -- that flag existed only to suppress the empty state, and
   * the empty state is now correct in every case.
   */
  const [libraryTick, setLibraryTick] = useState(0);
  useEffect(() => {
    if (!libraryTick) return;
    void refresh();
  }, [libraryTick, refresh]);

  /**
   * LIMITATIONS 1.7: the first fetch happens before a profile exists, so its
   * response carries no `progress`. Picking a profile has to trigger a second
   * fetch or the dock reads as empty until the listener leaves and comes back.
   *
   * Keyed on the profile itself rather than on a tick, so it fires on every
   * change of who is listening, including a switch from the profile menu.
   */
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

  /**
   * Coming back online has to fetch the library again.
   *
   * While the server was unreachable the app was showing the *device's* books,
   * so the server's list is stale the moment the connection returns -- and
   * nothing refetched it, because the only triggers were the profile changing
   * and the window regaining focus. Without this, the app says "online" and
   * shows the wrong list.
   */
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

  // Re-probe when the app comes back to the foreground. Without this, someone
  // who opened the app at home, left, and came back would stay stuck in the
  // offline branch until they force-quit and restart it.
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

  /**
   * Decide whether offline can be opened at all.
   *
   * Downloads without an envelope are not private data we can show. The app
   * says so instead of falling through on a stale localStorage profile.
   */
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
      setOfflineCacheExists(undefined);
      return;
    }
    const id = Number(activeProfileId);
    if (!Number.isInteger(id) || id < 1) {
      setOfflineCacheExists(false);
      return;
    }
    if (activeCacheProfileId() === id) {
      setOfflineCacheExists(true);
      setOfflineUnlocked(true);
      return;
    }

    let alive = true;
    void (async () => {
      const hasEnvelope = await hasProfileCache(id);
      if (!alive) return;
      // Biometric sign-in restores the DEK from the native Vault; it never
      // writes a keyEnvelopes row (no password to derive a KEK from). A saved
      // Vault value means this profile's cache exists offline and just needs
      // the biometric unlock to bring the key into memory.
      const vaultSaved = await biometricVault.hasSavedValue();
      if (!alive) return;
      const state = offlineCacheState(hasEnvelope, vaultSaved);
      setOfflineCacheExists(state.offlineCacheExists);
      setOfflineUnlocked(state.offlineUnlocked);
    })();
    return () => {
      alive = false;
    };
  }, [serverReachable, activeProfileId]);

  const canContinueOffline = device.books.length > 0;
  const handleContinueOffline = useCallback(() => {
    setShowServerSetup(false);
    setBypassServerSetup(true);
    setServerReachable(false);
  }, []);

  if ((needsServerUrl() || showServerSetup) && !bypassServerSetup) {
    return (
      <ServerSetup
        onDone={() => window.location.reload()}
        onContinueOffline={canContinueOffline ? handleContinueOffline : undefined}
      />
    );
  }

  // Still deciding whether the server is there. Rendering the login form now
  // would flash a password box at someone who is simply on a slow connection.
  //
  // The second condition matters as much as the first: if the server is *not*
  // there, the next question is "does this device have anything to play?", and
  // the answer lives in IndexedDB, which is read asynchronously. Deciding
  // before the device library has loaded would show "nothing to listen to" to
  // someone who has three books on the phone.
  if (serverReachable === undefined || (serverReachable === false && device.loading)) {
    return <Splash />;
  }

  /**
   * Offline.
   *
   * The point of downloading a book is to listen to it with no network, so being
   * unreachable must not mean being locked out. If this device has books and we
   * know who the listener was, go straight in and let the replica serve the
   * library.
   *
   * The profile is reused from `localStorage` rather than re-asked for: the
   * profile list lives on the server, so ProfileGate cannot run here, and the
   * last choice is the right one anyway.
   */
  if (!serverReachable) {
    if (device.books.length === 0) {
      return (
        <OfflineNotice
          hasBooks={false}
          onRetry={probeServer}
          onChangeServer={() => {
            setShowServerSetup(true);
            setBypassServerSetup(false);
          }}
        />
      );
    }
    if (!activeProfileId) {
      return (
        <OfflineNotice
          hasBooks
          onRetry={probeServer}
          onChangeServer={() => {
            setShowServerSetup(true);
            setBypassServerSetup(false);
          }}
        />
      );
    }
    if (offlineCacheExists === undefined) return <Splash />;
    if (!offlineCacheExists) {
      return (
        <OfflineNotice
          hasBooks
          noCache
          onRetry={probeServer}
          onChangeServer={() => {
            setShowServerSetup(true);
            setBypassServerSetup(false);
          }}
        />
      );
    }
    if (!offlineUnlocked) {
      return (
        <OfflineUnlock
          onUnlocked={() => {
            setOfflineUnlocked(true);
            // Re-read the replica now that the key is in memory, so cached
            // progress appears on the shelf immediately.
            void device.refresh();
            void browse.refresh();
          }}
        />
      );
    }
  }

  if (serverReachable && authed === false) {
    return (
      <AccountGate
        onSuccess={() => {
          setProfileId(getActiveProfileId());
          void (async () => {
            await refresh();
            probeServer();
          })();
        }}
      />
    );
  }

  if (serverReachable && authed && !session) return <Splash />;

  // Progress is profile-scoped: no profile selected means nothing can be
  // saved or restored, so pick (or create) one before browsing. A normal
  // profile session always has one; this is the break-glass household path
  // during the migration.
  if (serverReachable && authed && !activeProfileId) {
    return <ProfileGate onSuccess={() => setProfileId(getActiveProfileId())} />;
  }

  const submitRoot = async (event: FormEvent) => {
    event.preventDefault();
    setWorking(true);
    try {
      await addRoot(path, label);
      setPath("");
      setLabel("");
      setShowRootForm(false);
    } catch (requestError) {
      window.alert(requestError instanceof Error ? requestError.message : copy.operator.libraryFolders.addFolderFailed);
    } finally {
      setWorking(false);
    }
  };

  const runScan = async (rootId?: number) => {
    setWorking(true);
    try { await scan(rootId); } catch (requestError) { window.alert(requestError instanceof Error ? requestError.message : copy.operator.libraryFolders.scanFailed); } finally { setWorking(false); }
  };

  return (
    <div className="relative min-h-dvh bg-ground text-ink">
      <Specks />
      <header className="bar">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Mark />
            {/* `min-w-0` is load-bearing: the title sits beside a fixed-width
                control group, and without it the wordmark refuses to shrink and
                the row blows past a 360px phone. `e2e/phone-layout` asserts the
                document never exceeds the viewport. */}
            <div className="min-w-0 flex-1">
              <h1 className="wordmark truncate">{copy.brand.name}</h1>
              <p className="mt-0.5 truncate text-[12px] font-semibold text-ink3 tnum">
                {copy.shell.libraryCount(libraryBooks.length, roots.length)}
              </p>
            </div>
          </div>
          {/* On a phone this is its own row rather than competing with the
              wordmark: a theme toggle, two icon buttons and a profile select
              leave the title about 30px, which truncated "Audiobook Manager"
              down to three stacked letters. From `sm` up it joins the title on
              one line. `IconBtn` rather than `Btn`+`iconbtn`, which fought
              over border-radius and rendered a mismatched shape. */}
          <div className="flex items-center gap-2 sm:ml-auto">
            <ThemeToggle />
            <IconBtn label={copy.shell.settings} onClick={() => setShowSettings(true)}>
              <GearIcon size={19} aria-hidden="true" />
            </IconBtn>
            {/*
              The refresh control reports what it is doing rather than making
              the shelf vanish. Spinning the icon and `aria-busy` are enough to
              say "working" without taking the books away from someone who was
              reading the list.
            */}
            <IconBtn
              label={refreshing ? copy.shell.refreshing : copy.shell.refresh}
              aria-busy={refreshing || undefined}
              onClick={refreshEverything}
            >
              <RefreshCw size={19} className={refreshing ? "animate-spin" : ""} aria-hidden="true" />
            </IconBtn>
            <ProfileSwitcher />
          </div>
        </div>

        {/* One nav, two placements. On a phone it is fixed to the bottom as a
            rail; from `sm` up it returns to the flow under the header. A fixed
            descendant renders where it is told regardless of its DOM parent, so
            this stays a single element -- two navs would make the E2E
            `getByRole("navigation", { name: "Sections" })` ambiguous. */}
        <nav
          aria-label={copy.tabs.sections}
          className="rail fixed inset-x-0 bottom-0 z-40 pb-[max(10px,env(safe-area-inset-bottom))] sm:static sm:z-auto sm:border-t-0 sm:bg-transparent sm:backdrop-filter-none sm:pb-0"
        >
          <ul className="mx-auto flex w-full max-w-7xl gap-1.5 px-3 sm:justify-center sm:px-6">
            {TABS.map(({ id, label: tabLabel, icon: Icon }) => (
              <li key={id} className="min-w-0 flex-1 sm:flex-none">
                <button
                  type="button"
                  onClick={() => openTab(id)}
                  aria-current={tab === id ? "page" : undefined}
                  className={cn(
                    "flex w-full flex-col items-center justify-center gap-1 rounded-[16px_13px_16px_13px/13px_16px_13px_16px] px-2 py-2 text-[11px] font-bold transition sm:flex-row sm:gap-2 sm:px-4 sm:py-2.5 sm:text-[13.5px]",
                    tab === id
                      ? "bg-rasp text-white shadow-[0_3px_0_-1px_color-mix(in_srgb,var(--ink)_70%,transparent)]"
                      : "text-ink2 hover:bg-ink/5",
                  )}
                >
                  <Icon size={17} aria-hidden="true" />
                  <span className="truncate">{tabLabel}</span>
                  {id === "favourites" && favouriteIds.size > 0 && (
                    <span className="ml-0.5 rounded-full bg-ink/15 px-1.5 text-[10px] text-ink2 tnum sm:bg-ink/10">
                      {favouriteIds.size}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      {/* `pt-7` not `pt-5`: a tab that opens straight into a heading
        (Favourites, Discover) needs more air above the heading than below it,
        or the word reads as part of the header above.

        Note the braces around this comment. A block comment left bare in JSX
        expression position is parsed as text and renders on the page, which is
        exactly what shipped to a Pixel 4a once. */}
      <main className="relative z-10 mx-auto w-full max-w-7xl px-4 pb-28 pt-7 sm:px-6 sm:pb-14 sm:pt-9">
        {error && !offline && (
          <Notice tone="error" role="alert" className="mb-6">
            {error}
          </Notice>
        )}

        {offline && (
          <Notice tone="warn" role="status" icon={<WifiOff size={16} aria-hidden="true" />} className="mb-6">
            <p>{copy.shell.offlineBanner(device.books.length)}</p>
            {/* Why it is offline, not just that it is. "Offline" is a symptom,
                and the person cannot tell from it whether the server is down
                or the *phone* cannot reach it -- which are the two things that
                actually happen, and they have different fixes. */}
            <p className="mt-1 text-[12.5px]">{copy.shell.offlineBannerHint}</p>
          </Notice>
        )}

        {tab === "library" && (
          <>
            {/*
              Order is the thesis: the dock and the shelf come first, and every
              operator control comes last.

              The previous arrangement put the hero, the scan button and the
              library folders above the books, which meant the capsule -- the
              signature move, and the only reason this app is not a list -- never
              appeared in the first viewport on any device. A listener should see
              what they have, not what the operator maintains.
            */}
            <ContinueListening books={inProgressBooks(libraryBooks)} onSelect={setSelectedBook} />
            <SearchBar value={search} onChange={onSearchChange} resultCount={searchedBooks.length} />
            <section>
              <MachineHead
                title={copy.library.heading}
                count={
                  search.trim()
                    ? copy.library.countMatching(searchedBooks.length)
                    : copy.library.countInLibrary(searchedBooks.length)
                }
              >
                {working ? <LoaderCircle className="animate-spin text-rasp" size={20} /> : null}
                {/*
                  The books stay on screen while a refresh is in flight, so
                  something has to say the numbers are about to change.
                  `role="status"` because it appears without being asked for and
                  a screen reader should announce it once, politely.
                */}
                {refreshing && (
                  <span role="status" className="flex items-center gap-1.5 text-[12.5px] font-bold text-ink3">
                    <RefreshCw size={13} className="animate-spin" aria-hidden="true" />
                    {copy.shell.refreshingShort}
                  </span>
                )}
              </MachineHead>
              <StatusLegend className="mb-4" />
              {loading && !libraryBooks.length ? (
                /* Only reachable before the first response has ever arrived: the
                   hook latches `loading` false once anything has loaded, so a
                   refresh can never get here.

                   The `!libraryBooks.length` matters offline. The banner above
                   says "showing the 2 books downloaded to this device", and a
                   "Loading library…" panel underneath it contradicts that --
                   the books are *here*, the server is what is missing. */
                <div className="panel panel--sunk px-6 py-20 text-center text-ink2">{copy.shell.loadingLibrary}</div>
              ) : (
                <AudiobookGrid
                  books={searchedBooks}
                  emptyMessage={copy.library.empty}
                  emptyAction={
                    <Btn variant="quiet" size="sm" onClick={() => openTab("server-library")}>
                      <Server size={15} aria-hidden="true" /> {copy.library.chooseBooks}
                    </Btn>
                  }
                  {...gridProps}
                />
              )}
            </section>

            {canManageLibrary && (
              <>
            <section className="mt-12">
              <MachineHead title={copy.operator.libraryFolders.heading} />
              <p className="text-[13.5px] text-ink2">{copy.operator.libraryFolders.intro}</p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Btn
                  variant="primary"
                  onClick={() => void runScan()}
                  disabled={working || !roots.length}
                >
                  <ScanLine size={18} aria-hidden="true" /> {copy.operator.libraryFolders.scanLibrary}
                </Btn>
                <Btn variant="quiet" size="sm" onClick={() => setShowRootForm((visible) => !visible)}>
                  <FolderPlus size={17} aria-hidden="true" /> {copy.operator.libraryFolders.addFolder}
                </Btn>
              </div>
              {showRootForm && (
                <form onSubmit={submitRoot} className="panel mb-4 grid gap-3 p-4 sm:grid-cols-[1fr_180px_auto]">
                  <input value={path} onChange={(event) => setPath(event.target.value)} placeholder={copy.operator.libraryFolders.folderPathPlaceholder} required className="field" aria-label={copy.operator.libraryFolders.folderPathLabel} />
                  <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder={copy.operator.libraryFolders.folderLabelPlaceholder} className="field" aria-label={copy.operator.libraryFolders.folderLabelLabel} />
                  <Btn type="submit" disabled={working}>{copy.operator.libraryFolders.addFolder}</Btn>
                </form>
              )}
              {roots.length ? (
                /* `min-w-0` on each panel is load-bearing. A grid item defaults to
                   `min-width: auto`, so a single unbreakable value -- a Windows
                   path like C:\Users\...\audiobook-manager\test -- sets the
                   panel's min-content width and the grid blows out sideways.
                   `min-w-0` on the inner flex child is not enough on its own; it
                   lowers the child's minimum, not the track's. */
                <div className="grid gap-3 md:grid-cols-2">
                  {roots.map((root, index) => (
                    <div key={root.id} className={cn("panel flex min-w-0 items-center justify-between gap-3 px-4 py-3", index % 2 && "rotate-[0.6deg]")}>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-bold">{root.label || root.path}</p>
                        <p className="truncate text-[12px] text-ink3">
                          {root.path} {root.scanState?.status && `· ${root.scanState.status}`}
                        </p>
                        {root.scanState?.message && <p className="mt-1 text-[12px] text-rasp-ink">{root.scanState.message}</p>}
                      </div>
                      <div className="ml-2 flex shrink-0 items-center gap-1">
                        <IconBtn label={copy.operator.libraryFolders.scanFolder(root.label || root.path)} onClick={() => void runScan(root.id)} disabled={working}>
                          <ScanLine size={16} aria-hidden="true" />
                        </IconBtn>
                        <IconBtn label={copy.operator.libraryFolders.removeFolder(root.label || root.path)} onClick={() => void removeRoot(root.id)}>
                          <Trash2 size={16} aria-hidden="true" />
                        </IconBtn>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="panel panel--sunk px-4 py-5 text-sm text-ink2">{copy.operator.libraryFolders.noFolders}</p>
              )}
            </section>

            <div className="mt-8">
              {browse.enrichment && browse.enrichment.status !== "idle" && (
                <Notice className="mb-4">
                  {copy.operator.enrichment.notice(
                    browse.enrichment.status,
                    browse.enrichment.processed,
                    browse.enrichment.queued,
                    browse.enrichment.applied,
                    browse.enrichment.review,
                  )}
                </Notice>
              )}

              <ReviewQueue books={browse.reviewQueue} onResolved={() => { void refresh(); void browse.refresh(); }} />
            </div>
              </>
            )}
          </>
        )}

        {tab === "browse" && (
          <>
            <section className="mb-7">
              <h2 className="text-[30px] leading-[1.05] sm:text-4xl">{copy.browse.heading}</h2>
              <p className="mt-2 max-w-xl text-ink2">{copy.browse.intro}</p>
            </section>

            <SearchBar value={search} onChange={onSearchChange} resultCount={filteredBooks.length} />
            <FilterBar books={libraryBooks} filters={filters} onChange={onFiltersChange} genres={browse.genres} />

            {isFilterActive(filters) || search.trim().length > 0 ? (
              <section>
                <MachineHead title={copy.browse.filteredHeading} count={plural(filteredBooks.length, "book")} />
                <AudiobookGrid
                  books={filteredBooks}
                  emptyMessage={copy.library.noMatches}
                  {...gridProps}
                />
              </section>
            ) : (
              <>
                <Shelves shelves={genreShelves} onSelect={setSelectedBook} favouriteIds={favouriteIds} onToggleFavourite={toggleFavourite} emptyMessage={copy.browse.noGenreShelves} />
                {seriesShelves.length > 0 && (
                  <section className="mt-4">
                    <MachineHead title={copy.browse.seriesHeading} />
                    <Shelves shelves={seriesShelves} onSelect={setSelectedBook} favouriteIds={favouriteIds} onToggleFavourite={toggleFavourite} />
                  </section>
                )}
              </>
            )}

            <div className="mt-10">
              <TagManager tags={browse.tags} onChanged={() => void browse.refresh()} />
            </div>
          </>
        )}

        {tab === "discover" && <Discover discover={discover} hasFavourites={favouriteIds.size > 0} />}

        {tab === "server-library" && (
          <ServerLibrary
            books={library.serverLibrary}
            loading={library.serverLibraryLoading}
            error={library.serverLibraryError}
            onLoad={library.loadServerLibrary}
            onAdd={library.addToLibrary}
            onRemove={library.removeFromLibrary}
            isDownloaded={isNativeShell() ? device.isDownloaded : undefined}
            onDeleteDownload={isNativeShell() ? device.remove : undefined}
            onOpen={setSelectedBook}
            /* Offline the shelf is out of reach, so the tab shows the books on
               this device -- which is your library while the server is
               unreachable -- and lets them be taken away. */
            offline={offline}
            offlineBooks={device.books}
            onRemoveDevice={isNativeShell() ? device.remove : undefined}
          />
        )}

        {tab === "favourites" && (
          <section>
            <h2 className="text-[30px] leading-[1.05] sm:text-4xl">{copy.favourites.heading}</h2>
            <p className="mb-6 mt-2 max-w-xl text-ink2">
              {favouriteIds.size === 0 ? copy.favourites.empty : copy.favourites.count(favouriteIds.size)}
            </p>
            <AudiobookGrid
              books={favouriteBooks}
              emptyMessage={copy.library.noFavourites}
              {...gridProps}
            />
          </section>
        )}
      </main>

      <footer className="relative z-10 px-5 pb-28 pt-6 text-center text-[12px] text-ink3 sm:pb-10">
        {copy.brand.footer}
      </footer>
      {selectedBook && <AudiobookDetail
        book={selectedBook}
        onClose={() => setSelectedBook(undefined)}
        onProgressSaved={() => {
          setLibraryTick((tick) => tick + 1);
          // Offline the server refetch fails, so the replica's cached progress
          // is what refreshes the shelf.
          void device.refresh();
        }}
        genres={browse.genres}
        tags={browse.tags}
        favourited={favouriteIds.has(selectedBook.id)}
        onToggleFavourite={toggleFavourite}
        onFindSimilar={findSimilar}
        onBookUpdated={() => { void refresh(); void browse.refresh(); }}
        /* Spec 27: removing a book from this profile's library. */
        onRemoveFromLibrary={library.removeFromLibrary}
        isDownloaded={isNativeShell() ? device.isDownloaded(selectedBook.id) : false}
        onDeleteDownload={isNativeShell() ? device.remove : undefined}
        deviceAction={
          isNativeShell() ? (
            <DownloadButton
              book={selectedBook}
              fraction={device.progressOf(selectedBook.id)}
              isDownloaded={device.isDownloaded(selectedBook.id)}
              bytes={device.bytesFor(selectedBook.id)}
              onDownload={device.download}
              onRemove={device.remove}
            />
          ) : undefined
        }
        localUrlForTrack={isNativeShell() ? device.localUrlForTrack : undefined}
        profileId={activeProfileId}
      />}

      {showSettings && (
        <Settings
          usedBytes={device.usedBytes}
          downloadedCount={device.books.length}
          offline={offline}
          coverBytes={coverCacheBytes()}
          onClearCovers={async () => { await clearCoverCache(); }}
          onClose={() => setShowSettings(false)}
          onSaved={() => { void refresh(); void device.refresh(); }}
        />
      )}
    </div>
  );
}

export default App;
