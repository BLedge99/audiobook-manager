import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Compass, Heart, Library, LayoutGrid, RefreshCw, WifiOff, Server, Settings as GearIcon, Link2 } from "lucide-react";
import { AudiobookDetail } from "./components/AudiobookDetail";
import { AudiobookGrid, ContinueListening, inProgressBooks } from "./components/AudiobookGrid";
import { Discover } from "./components/Discover";
import { FilterBar } from "./components/FilterBar";
import {
  needsServerUrl,
  onServerUnreachable,
  isFromThisServer,
  setAccountExperience as setApiAccountExperience,
  getActiveProfileId,
  setActiveProfileId,
  setSessionToken,
  lockLocal,
  type SessionInfo,
} from "./lib/api";
import { isOfflineMode, setOfflineMode as persistOfflineMode } from "./lib/offlineMode";
import { AccountGate } from "./components/AccountGate";
import { Splash } from "./components/OfflineNotice";
import { OfflineGateView } from "./components/OfflineGateView";
import { WakingServer } from "./components/WakingServer";

import { offlineScreen } from "./lib/offlineGate";
import { ConnectionStatus } from "./components/ConnectionStatus";
import { ProfileGate } from "./components/ProfileGate";
import { ServerSetup } from "./components/ServerSetup";
import { AccountMenu } from "./components/AccountMenu";
import { ReviewQueue } from "./components/ReviewQueue";
import { SearchBar } from "./components/SearchBar";
import { ServerLibrary } from "./components/ServerLibrary";
import { Shelves } from "./components/Shelves";
import { TagManager } from "./components/TagManager";
import {
  filtersFromQuery,
  filtersToQuery,
  isFilterActive,
  type Filters,
} from "./lib/browse";
import { searchFromQueryParam, searchToQueryParam } from "./lib/search";
import { isNativeShell } from "./lib/platform";
import { useDerivedLibrary } from "./lib/useDerivedLibrary";
import { resolveProfileContext } from "./lib/profiles";
import { useShelfRefresh } from "./lib/useShelfRefresh";
import { useProfileCache } from "./lib/useProfileCache";
import { useBackgroundLock } from "./lib/backgroundLock";
import { useSession } from "./lib/useSession";
import { getServerUrl } from "./lib/api";
import { clearCoverCache, coverCacheBytes, warmCoverCache } from "./local/CoverImage";
import { useDeviceLibrary } from "./local/useDeviceLibrary";
import { useExternalSheet } from "./lib/useExternalSheet";
import { ExternalBooks, AddExternalBookDialog } from "./components/ExternalBooks";
import { canSeeBuySurfaces } from "./local/kids";
import { isDemoExperience } from "./local/experience";
import { Settings } from "./components/Settings";
import { DownloadButton } from "./components/DownloadButton";
import { useBrowse, useDiscover } from "./useBrowse";
import { useLibrary } from "./useLibrary";
import { copy, plural } from "./copy";
import { Specks, ThemeToggle, Notice, MachineMark, MachineHead, PageHead, StatusLegend, Btn, IconBtn, EmptyPanel, cn } from "./ui/primitives";
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
 * The machine's mark comes from the shared primitives (`ui/primitives`), the
 * same one the gates and the wordmark use â€” one drawing, everywhere.
 */

function App() {
  /** The server-derived identity (spec 28); null until the probe resolves. */
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [accountExperience, setAccountExperience] = useState<"household" | "demo">("household");
  const canManageLibrary = session?.role === "admin";
  const library = useLibrary(canManageLibrary);
  const {
    books,
    roots,
    loading,
    refreshing,
    error,
    refresh,
    refreshForProfile,
  } = library;
  const device = useDeviceLibrary(isNativeShell());
  const {
    items: externalItems,
    addExternalOpen,
    setAddExternalOpen,
    externalLaunchFailed,
    openExternal,
    removeExternal,
    addExternal,
  } = useExternalSheet();
  const discover = useDiscover();
  // Read the device cover cache into memory once, before the grid renders its
  // first card (spec 15b feature 1). Without this a cold start asks IndexedDB
  // per cover, and a cold start *offline* would show a shelf of placeholders
  // while each one discovered, one at a time, that it already had the bytes.
  useEffect(() => {
    void warmCoverCache();
  }, []);

  const [selectedBook, setSelectedBook] = useState<Audiobook>();
  const [authed, setAuthed] = useState<boolean>();
  const [showServerSetup, setShowServerSetup] = useState(false);
  const [bypassServerSetup, setBypassServerSetup] = useState(false);
  const [offlineMode, setOfflineMode] = useState<boolean>(() => isOfflineMode());
  const offlineModeRef = useRef(offlineMode);
  const accountExperienceRef = useRef(accountExperience);
  useEffect(() => {
    accountExperienceRef.current = accountExperience;
  }, [accountExperience]);
  /**
   * Whether the server answered at all, as distinct from whether it said 401.
   *
   * These were conflated into one `authed` boolean, which meant an unreachable
   * server looked identical to being logged out -- so the app demanded a login it
   * could never complete. Someone who had downloaded a book to listen on a plane
   * was locked out of it by the very feature that let them download it.
   */
  const [serverReachable, setServerReachable] = useState<boolean | undefined>(() => offlineMode ? false : undefined);
  /**
   * A slow probe is in flight â€” the fast probe failed and the patient one
   * hasn't answered yet, which on the free tier means "waking up", not
   * "absent". While this is true the app renders the waking screen rather
   * than the unlock-offline gate it would otherwise fall through to.
   */
  const [serverWaking, setServerWaking] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(() => getActiveProfileId());
  /**
   * The session profile is authoritative; localStorage is the break-glass hint.
   *
   * The shelf and the player answer different questions, so they resolve through
   * the same rules rather than through two ternaries that shared no code.
   */
  const { activeProfileId, playerProfileId } = resolveProfileContext({
    accountExperience,
    sessionProfile: session?.profile ?? null,
    storedProfileId: profileId,
  });
  // Browse is mounted here rather than with the other data hooks, because it
  // needs to know who is listening: the profile id is what tells it to
  // refetch. It used to read that id out of localStorage during render, which
  // meant it polled a global to notice a change it should have been told
  // about.
  const browse = useBrowse(activeProfileId);
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
   * Re-run after a known outage so returning home recovers without a manual
   * restart. Explicit offline mode is a separate choice and suppresses probes.
   *
   * The probe is **bounded** (see `lib/reachability.ts`): a host that is
   * unreachable but silent never answers, and an unbounded request left the
   * app on the splash for good.
   */
  const { probeServer } = useSession({
    offlineModeRef,
    // Read the mode at call time: /api/config may have flipped it since mount.
    getAccountExperience: () => accountExperienceRef.current,
    setServerReachable,
    setAuthed,
    setSession,
    setSessionToken,
    setProfileId,
    setActiveProfileId,
    setAccountExperience,
    setApiAccountExperience,
    setBypassServerSetup,
    setServerWaking,
  });

  useEffect(() => {
    void probeServer();
  }, [probeServer]);

  // Offline cache discovery and the offline-unlock state (spec 29). The
  // implementation lives in lib/useProfileCache.ts (spec 43 phase 6.2);
  // the offline screen decision stays in lib/offlineGate.ts.
  const { cacheState, offlineUnlocked, setOfflineUnlocked, skippedUnlock, setSkippedUnlock } =
    useProfileCache({ serverReachable, activeProfileId, setProfileId });

  /**
   * The refresh button.
   *
   * When the server is believed to be unreachable, this also re-probes. The
   * person tapping refresh is saying "try again", and the app's own belief
   * about whether the server is there is exactly what is in doubt -- so the
   * button is the one place that settles it.
   */
  const refreshEverything = useCallback(() => {
    if (offlineMode) {
      void device.refresh();
      return;
    }
    if (serverReachable === false) {
      probeServer();
      void device.refresh();
      return;
    }
    void refresh();
  }, [offlineMode, serverReachable, probeServer, refresh, device]);

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
  //
  // This is a *local* lock: clear the in-memory token and offline DEK. It must
  // not revoke the server session or sign the listener out of the app -- the
  // listening position lives in the local state and syncs on the next connect,
  // so a backgrounded player should never be logged out by a timer.
  //
  // Spec 36: the lock used to clear the token and then carry on looking
  // signed in, so every request failed with a 401 and the app was unusable
  // until it was restarted. It now returns the app to the account gate, where
  // the fingerprint prompt lives.
  //
  // It waits for playback to finish, because the gate replaces the app and the
  // app holds the audio element. See lib/backgroundLock.ts.
  const lockToGate = useCallback(() => {
    void lockLocal();
    setOfflineUnlocked(false);
    // The token is gone, so the app is no longer signed in. Saying otherwise
    // is what left every request failing with a 401.
    setAuthed(false);
    setSession(null);
  }, [setOfflineUnlocked]);

  useBackgroundLock({ enabled: isNativeShell(), lock: lockToGate });

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
   * Which books to show â€” the derived-library bundle moved to
   * lib/useDerivedLibrary.ts (spec 43 phase 6.2). Offline with nothing
   * downloaded is still the app: the shelf shows an honest empty state.
   */
  const offline = offlineMode || serverReachable === false;
  const {
    libraryBooks,
    favouriteIds,
    filteredBooks,
    searchedBooks,
    favouriteBooks,
    reviewIds,
    genreShelves,
    seriesShelves,
  } = useDerivedLibrary({
    offline,
    books,
    deviceBooks: device.books,
    sessionRole: session?.role,
    ageBand: session?.profile?.ageBand,
    favourites: browse.favourites,
    reviewQueue: browse.reviewQueue ?? [],
    genres: browse.genres,
    filters,
    search,
    serverUrl: getServerUrl(),
  });

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
    // Favourites live on the connected server; a foreign book with this id is
    // not the book the listener tapped, and favouriting it would toggle someone
    // else's catalogue entry. The components hide the heart for these books
    // already â€” this is the belt to that braces.
    if (!libraryBooks.some((book) => book.id === bookId && isFromThisServer(book))) return;
    void browse.toggleFavourite(bookId);
  }, [browse, libraryBooks]);

  const onFindSimilar = useCallback((book: Audiobook) => findSimilar(book.id), [findSimilar]);
  // Stable identity, so memoized grids/cards bail out on unrelated re-renders.
  const gridProps = useMemo(
    () => ({
      onSelect: setSelectedBook,
      favourites: favouriteIds,
      onToggleFavourite: toggleFavourite,
      onFindSimilar,
      changedIds: reviewIds,
    }),
    [favouriteIds, toggleFavourite, onFindSimilar, reviewIds],
  );

  /**
   * The shelf's refresh triggers (progress saved, server recovered, profile
   * changed, window focus). The implementation lives in
   * `lib/useShelfRefresh.ts` (spec 43 phase 6.2); the rules live in
   * `lib/refreshPolicy.ts`.
   */
  const { bumpLibraryTick } = useShelfRefresh({
    profileId,
    serverReachable,
    refresh,
    refreshForProfile,
  });

  const handleContinueOffline = useCallback((preserveUnlockedCache = false) => {
    offlineModeRef.current = true;
    persistOfflineMode(true);
    setOfflineMode(true);
    setShowServerSetup(false);
    setBypassServerSetup(true);
    setServerReachable(false);
    setAuthed(false);
    setSession(null);
    setOfflineUnlocked(preserveUnlockedCache);
    if (!preserveUnlockedCache) void lockLocal();
  }, [setOfflineUnlocked]);

  /** Leave for the server-address screen; shared by every offline exit. */
  const openServerSetup = useCallback(() => {
    setShowServerSetup(true);
    setBypassServerSetup(false);
  }, []);

  const retryOffline = useCallback(() => {
    // "Try again" has to mean both halves. It used to re-probe the server only,
    // so a replica read that had failed stayed failed however many times the
    // button was pressed.
    probeServer();
    void device.refresh();
  }, [probeServer, device]);

  // Spec 29 recovery: adopt audio that outlived its database row.
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
            // The server could not be asked. That is not the same as "nothing
            // here matches", and the files were left untouched either way.
            ? copy.offline.recoverFailed
            : copy.offline.unclaimedNothing,
      );
    } catch {
      setRecoverMessage(copy.offline.recoverFailed);
    } finally {
      setRecovering(false);
    }
  }, [device]);

  if ((needsServerUrl() || showServerSetup) && !bypassServerSetup) {
    return (
      <ServerSetup
        onDone={() => window.location.reload()}
        /* Always offered in the native shell (spec 29). It used to require
           loaded books, which hid the escape exactly when the library could not
           be read, and it was disabled while a health check ran -- so a hanging
           check could keep someone out of their downloads. */
        onContinueOffline={isNativeShell() ? handleContinueOffline : undefined}
      />
    );
  }

  // Still deciding whether the server is there. Rendering the login form now
  // Waking: the fast probe failed and the server is answering slowly (Render
  // free tier). Show that instead of the offline gate or a stuck splash.
  if (!offlineMode && serverWaking) {
    return (
      <WakingServer
        onRetry={() => probeServer(true)}
        onContinueOffline={() => handleContinueOffline(true)}
      />
    );
  }

  // would flash a password box at someone who is simply on a slow connection.
  if (!offlineMode && serverReachable === undefined) return <Splash />;

  /**
   * Offline: one tested decision, not a ladder of `if`s (spec 29).
   *
   * The table lives in `lib/offlineGate.ts`; this file only renders its answer.
   * The rule it encodes is that being unreachable never dead-ends: every screen
   * below has at least one action that leaves it.
   */
  const screen = offline
    ? offlineScreen({
        deviceLoading: device.loading,
        booksOnDevice: device.books.length,
        libraryReadError: device.error,
        hasProfile: Boolean(activeProfileId),
        cache: cacheState,
        unlocked: offlineUnlocked,
        skippedUnlock,
        isNativeShell: isNativeShell(),
      })
    : null;

  if (offline && screen && screen.kind !== "shell") {
    // The ladder in `offlineGate` picked the screen; the precedence lives
    // there, not here. "shell" falls through to the normal shelf.
    return (
      <OfflineGateView
        screen={screen}
        hasBooks={device.books.length > 0}
        onRetry={retryOffline}
        onChangeServer={openServerSetup}
        onUnlocked={() => {
          setOfflineUnlocked(true);
          // Re-read the replica now that the key is in memory, so cached
          // progress appears on the shelf immediately.
          void device.refresh();
          void browse.refresh();
        }}
        onListenWithoutProgress={() => setSkippedUnlock(true)}
      />
    );
  }

  /** Whether progress and favourites can actually be read on this screen. */
  const progressAvailable =
    !offline || (screen?.kind === "shell" ? screen.progressAvailable : false);
  /** Offline shows the library only: every other tab needs the server. */
  const visibleTabs = offline ? TABS.filter((entry) => entry.id === "library") : TABS;
  const shownTab: Tab = offline ? "library" : tab;

  if (serverReachable && authed === false) {
    return (
      <AccountGate
        accountExperience={accountExperience}
        onSuccess={(result) => {
          if (result?.offline) {
            handleContinueOffline(true);
            return;
          }
          setProfileId(isDemoExperience(accountExperience) ? null : getActiveProfileId());
          void (async () => {
            // The mount-shaped refresh fired before sign-in had a session, so
            // its favourites batch came back 401 and the shelf rendered with
            // no hearts. Fire it again now that the cookie exists -- the
            // shelf should already know the listener's favourites.
            await refresh();
            await browse.refresh();
            await probeServer();
          })();
        }}
        onContinueOffline={isNativeShell() ? handleContinueOffline : undefined}
      />
    );
  }

  if (serverReachable && authed && !session) return <Splash />;

  // Progress is profile-scoped: no profile selected means nothing can be
  // saved or restored, so pick (or create) one before browsing. A normal
  // profile session always has one; this is the break-glass household path
  // during the migration.
  if (serverReachable && authed && !activeProfileId && !isDemoExperience(accountExperience)) {
    return (
      <ProfileGate
        onSuccess={() => {
          setProfileId(getActiveProfileId());
          // The mount-shaped refresh had no profile header yet, so it asked
          // /api/favourites/ids for a profile it never named. Redo it now.
          void browse.refresh();
          void probeServer();
        }}
        onContinueOffline={isNativeShell() ? handleContinueOffline : undefined}
      />
    );
  }

  return (
    <div className="atmosphere relative min-h-dvh text-ink">
      <Specks />
      <header className="bar">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <MachineMark />
            {/* `min-w-0` is load-bearing: the title sits beside a fixed-width
                control group, and without it the wordmark refuses to shrink and
                the row blows past a 360px phone. `e2e/phone-layout` asserts the
                document never exceeds the viewport. */}
            <div className="min-w-0 flex-1">
              <h1 className="wordmark truncate">{copy.brand.name}</h1>
              {/* --ink, not ink-2: pass 4 darkened the ramp past the point
                  where ink-2 holds AA against the bar's top sheen strip
                  (3.33:1 worst case; 4.54:1 flat). ink clears 5.23:1 even
                  with the strip -- see .bar in index.css. */}
              <p className="mt-0.5 truncate text-[0.75rem] font-semibold text-ink tnum">
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
            <ConnectionStatus offlineMode={offlineMode} serverReachable={serverReachable} />
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
            {/* The profile list lives on the server, so offline the switcher has
                nothing to offer and would open a panel that cannot fill. */}
            {!offline && <AccountMenu session={session} />}
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
            {visibleTabs.map(({ id, label: tabLabel, icon: Icon }) => (
              <li key={id} className="min-w-0 flex-1 sm:flex-none">
                <button
                  type="button"
                  onClick={() => openTab(id)}
                  aria-current={shownTab === id ? "page" : undefined}
                  className={cn(
                    "flex min-w-0 w-full flex-col items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-[16px_13px_16px_13px/13px_16px_13px_16px] px-1 py-2 text-[0.6875rem] font-bold transition sm:flex-row sm:gap-2 sm:px-4 sm:py-2.5 sm:text-[0.84375rem]",
                    shownTab === id
                      ? "bg-rasp text-white shadow-[0_3px_0_-1px_color-mix(in_srgb,var(--ink)_70%,transparent)]"
                      : "text-ink2 hover:bg-ink/5",
                  )}
                >
                  <Icon size={17} className="shrink-0" aria-hidden="true" />
                  <span className="min-w-0 max-w-full truncate">{tabLabel}</span>
                  {id === "favourites" && favouriteIds.size > 0 && (
                    <span className="ml-0.5 shrink-0 rounded-full bg-ink/15 px-1.5 text-[0.625rem] text-ink2 tnum sm:bg-ink/10">
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

        {offline && device.books.length > 0 && (
          <Notice tone="warn" role="status" icon={<WifiOff size={16} aria-hidden="true" />} className="mb-6">
            <p>{copy.shell.offlineBanner(device.books.length)}</p>
            {/* Why it is offline, not just that it is. "Offline" is a symptom,
                and the person cannot tell from it whether the server is down
                or the *phone* cannot reach it -- which are the two things that
                actually happen, and they have different fixes. */}
            <p className="mt-1 text-[0.78125rem]">{copy.shell.offlineBannerHint}</p>
          </Notice>
        )}

        {/*
          Listening without unlocking is allowed, but not silently pretending
          progress is being kept. One persistent line, never a prompt: asking
          again on every track would be nagging (spec 29).
        */}
        {offline && !progressAvailable && device.books.length > 0 && (
          <Notice tone="warn" role="status" className="mb-6">
            {copy.offline.progressNotSaved}
          </Notice>
        )}

        {shownTab === "library" && (
          <>
            {/*
              Spec 29: audio can outlive the database row that described it --
              the WebView origin change left exactly this. Say so where the loss
              is felt (the shelf), and let the server re-adopt the files.
            */}
            {isNativeShell() && device.unclaimed.length > 0 && (
              <Notice tone="warn" role="status" className="mb-6">
                <p>{copy.offline.unclaimed(device.unclaimed.length)}</p>
                {offline ? (
                  <p className="mt-1 text-[0.78125rem]">{copy.offline.unclaimedOffline}</p>
                ) : (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Btn
                      size="sm"
                      variant="primary"
                      disabled={recovering}
                      onClick={() => void recoverDownloads()}
                    >
                      {recovering ? copy.offline.unclaimedFinding : copy.offline.unclaimedAction}
                    </Btn>
                    {recoverMessage && (
                      <span className="text-[0.78125rem] font-bold">{recoverMessage}</span>
                    )}
                  </div>
                )}
              </Notice>
            )}
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
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <SearchBar value={search} onChange={onSearchChange} resultCount={searchedBooks.length} />
              </div>
              {/* Spec 39: books the listener owns elsewhere â€” never the server, never playable */}
              {canSeeBuySurfaces(session?.role) && (
                <Btn variant="quiet" size="sm" className="shrink-0" onClick={() => setAddExternalOpen(true)}>
                  <Link2 size={15} aria-hidden="true" /> {copy.external.addButton}
                </Btn>
              )}
            </div>
            <section>
              <MachineHead
                title={copy.library.heading}
                count={
                  search.trim()
                    ? copy.library.countMatching(searchedBooks.length)
                    : copy.library.countInLibrary(searchedBooks.length)
                }
              >
                {/*
                  The books stay on screen while a refresh is in flight, so
                  something has to say the numbers are about to change.
                  `role="status"` because it appears without being asked for and
                  a screen reader should announce it once, politely.
                */}
                {refreshing && (
                  <span role="status" className="flex items-center gap-1.5 text-[0.78125rem] font-bold text-ink3">
                    <RefreshCw size={13} className="animate-spin" aria-hidden="true" />
                    {copy.shell.refreshingShort}
                  </span>
                )}
              </MachineHead>
              <StatusLegend className="mb-4" />
              {loading && !libraryBooks.length && !offline ? (
                /* Only reachable before the first response has ever arrived: the
                   hook latches `loading` false once anything has loaded, so a
                   refresh can never get here. */
                <EmptyPanel className="py-20">{copy.shell.loadingLibrary}</EmptyPanel>
              ) : (
                <AudiobookGrid
                  books={searchedBooks}
                  /*
                   * Offline with nothing downloaded is not a failure screen any
                   * more: it is the library, empty, with the two actions that
                   * can refill it. `chooseBooks` would open a tab that needs the
                   * server, so it is replaced rather than shown dead.
                   */
                  emptyMessage={offline ? copy.offline.emptyHeading : copy.library.empty}
                  emptyAction={
                    offline ? (
                      <div className="grid grid-cols-[minmax(0,1fr)] justify-items-center gap-3">
                        <p className="max-w-sm text-sm text-ink2">{copy.offline.emptyIntro}</p>
                        <div className="flex flex-wrap justify-center gap-2">
                          <Btn variant="primary" size="sm" onClick={retryOffline}>
                            <RefreshCw size={15} aria-hidden="true" /> {copy.offline.tryAgain}
                          </Btn>
                          <Btn variant="quiet" size="sm" onClick={openServerSetup}>
                            {copy.operator.serverSetup.changeAddress}
                          </Btn>
                        </div>
                      </div>
                    ) : (
                      <Btn variant="quiet" size="sm" onClick={() => openTab("server-library")}>
                        <Server size={15} aria-hidden="true" /> {copy.library.chooseBooks}
                      </Btn>
                    )
                  }
                  {...gridProps}
                />
              )}
            </section>

            {/* Spec 39 â€” the external shelf. Not searchable, not filterable, never on the server. */}
            {canSeeBuySurfaces(session?.role) && search.trim().length === 0 && (
              <>
                <ExternalBooks role={session?.role} items={externalItems} onLaunch={openExternal} onRemove={removeExternal} />
                {externalLaunchFailed && (
                  <Notice tone="warn" className="mt-3">
                    {copy.external.launchFailed}
                  </Notice>
                )}
              </>
            )}

            {canManageLibrary && browse.enrichment && browse.enrichment.status !== "idle" && (
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
            {canManageLibrary && <ReviewQueue books={browse.reviewQueue} onResolved={() => { void refresh(); void browse.refresh(); }} />}
          </>
        )}

        {shownTab === "browse" && (
          <>
            <PageHead title={copy.browse.heading}>{copy.browse.intro}</PageHead>

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

            {!isDemoExperience(accountExperience) && <div className="mt-10">
              <TagManager tags={browse.tags} onChanged={() => void browse.refresh()} />
            </div>}
          </>
        )}

        {shownTab === "discover" && <Discover discover={discover} hasFavourites={favouriteIds.size > 0} canBuy={canSeeBuySurfaces(session?.role)} />}

        {shownTab === "server-library" && (
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

        {shownTab === "favourites" && (
          <section>
            <PageHead title={copy.favourites.heading}>
              {favouriteIds.size === 0 ? copy.favourites.empty : copy.favourites.count(favouriteIds.size)}
            </PageHead>
            <AudiobookGrid
              books={favouriteBooks}
              emptyMessage={copy.library.noFavourites}
              {...gridProps}
            />
          </section>
        )}
      </main>

      <footer className="relative z-10 px-5 pb-28 pt-6 text-center t-faint sm:pb-10">
        {copy.brand.footer}
      </footer>
      {selectedBook && <AudiobookDetail
        book={selectedBook}
        onClose={() => setSelectedBook(undefined)}
        onProgressSaved={() => {
          bumpLibraryTick();
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
        isDownloaded={isNativeShell() ? device.isDownloaded(selectedBook.id, selectedBook.serverId) : false}
        onDeleteDownload={isNativeShell() ? device.remove : undefined}
        deviceAction={
          isNativeShell() ? (
            <DownloadButton
              book={selectedBook}
              fraction={device.progressOf(selectedBook.id, selectedBook.serverId)}
              isDownloaded={device.isDownloaded(selectedBook.id, selectedBook.serverId)}
              bytes={device.bytesFor(selectedBook.id, selectedBook.serverId)}
              onDownload={device.download}
              onRemove={device.remove}
            />
          ) : undefined
        }
        localUrlForTrack={isNativeShell() ? device.localUrlForTrack : undefined}
        profileId={playerProfileId}
        role={session?.role}
      />}

      <AddExternalBookDialog
        open={addExternalOpen}
        role={session?.role}
        onClose={() => setAddExternalOpen(false)}
        onAdd={addExternal}
      />

      {showSettings && (
        <Settings
          usedBytes={device.usedBytes}
          downloadedCount={device.books.length}
          offline={offline}
          coverBytes={coverCacheBytes()}
          onClearCovers={async () => { await clearCoverCache(); }}
          onClose={() => setShowSettings(false)}
          onSaved={() => {
            // Spec 29: a saved address that answers ends the listener's
            // explicit offline choice. This used to live behind a separate
            // "Reconnect to server" button; it is now what "Save and test"
            // does when the server is reachable.
            offlineModeRef.current = false;
            persistOfflineMode(false);
            setOfflineMode(false);
            setServerReachable(undefined);
            void probeServer(true);
            void refresh();
            void device.refresh();
          }}
        />
      )}
    </div>
  );
}

export default App;




