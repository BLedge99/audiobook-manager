import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Compass, FolderPlus, Heart, Library, LayoutGrid, LoaderCircle, RefreshCw, ScanLine, Trash2, WifiOff, BookOpen } from "lucide-react";
import { AudiobookDetail } from "./components/AudiobookDetail";
import { AudiobookGrid, ContinueListening, inProgressBooks } from "./components/AudiobookGrid";
import { Discover } from "./components/Discover";
import { FilterBar } from "./components/FilterBar";
import { needsServerUrl } from "./lib/api";
import { LoginGate } from "./components/LoginGate";
import { OfflineNotice, Splash } from "./components/OfflineNotice";
import { ProfileGate } from "./components/ProfileGate";
import { ServerSetup } from "./components/ServerSetup";
import { ProfileSwitcher } from "./components/ProfileSwitcher";
import { ReviewQueue } from "./components/ReviewQueue";
import { SearchBar } from "./components/SearchBar";
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
import { useDeviceLibrary } from "./local/useDeviceLibrary";
import { Settings } from "./components/Settings";
import { DownloadButton } from "./components/DownloadButton";
import { useBrowse, useDiscover } from "./useBrowse";
import { useLibrary } from "./useLibrary";
import { Specks, ThemeToggle, Notice, MachineHead, StatusLegend, Btn, IconBtn, cn } from "./ui/primitives";
import type { Audiobook } from "./types";

type Tab = "library" | "browse" | "discover" | "favourites";

const TABS: { id: Tab; label: string; icon: typeof Library }[] = [
  { id: "library", label: "Library", icon: Library },
  { id: "browse", label: "Browse", icon: LayoutGrid },
  { id: "discover", label: "Discover", icon: Compass },
  { id: "favourites", label: "Favourites", icon: Heart },
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
  const { audiobooks, roots, loading, refreshing, error, refresh, addRoot, removeRoot, scan } = useLibrary();
  const device = useDeviceLibrary(isNativeShell());
  const browse = useBrowse();
  const discover = useDiscover();
  const [selectedBook, setSelectedBook] = useState<Audiobook>();
  const [path, setPath] = useState("");
  const [label, setLabel] = useState("");
  const [showRootForm, setShowRootForm] = useState(false);
  const [working, setWorking] = useState(false);
  const [authed, setAuthed] = useState<boolean>();
  /**
   * Whether the server answered at all, as distinct from whether it said 401.
   *
   * These were conflated into one `authed` boolean, which meant an unreachable
   * server looked identical to being logged out -- so the app demanded a login it
   * could never complete. Someone who had downloaded a book to listen on a plane
   * was locked out of it by the very feature that let them download it.
   */
  const [serverReachable, setServerReachable] = useState<boolean>();
  const [profileId, setProfileId] = useState<string | null>(() => window.localStorage.getItem("profileId"));
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
   */
  const probeServer = useCallback(() => {
    void fetch("/api/audiobooks")
      .then((res) => {
        setServerReachable(true);
        setAuthed(res.status !== 401);
      })
      .catch(() => {
        setServerReachable(false);
      });
  }, []);

  useEffect(() => {
    probeServer();
  }, [probeServer]);

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
    void refresh();
  }, [profileId, refresh]);

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

  if (needsServerUrl()) {
    return <ServerSetup onDone={() => window.location.reload()} />;
  }

  // Still deciding whether the server is there. Rendering the login form now
  // would flash a password box at someone who is simply on a slow connection.
  if (serverReachable === undefined) {
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
    if (device.books.length > 0 && profileId) {
      // Fall through to the app below.
    } else {
      return (
        <OfflineNotice
          hasBooks={device.books.length > 0}
          onRetry={probeServer}
        />
      );
    }
  }

  if (serverReachable && authed === false) {
    return <LoginGate onSuccess={() => { setAuthed(true); void refresh(); }} />;
  }

  // Progress is profile-scoped: no profile selected means nothing can be
  // saved or restored, so pick (or create) one before browsing.
  if (serverReachable && authed && !profileId) {
    return <ProfileGate onSuccess={() => setProfileId(window.localStorage.getItem("profileId"))} />;
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
      window.alert(requestError instanceof Error ? requestError.message : "Unable to add library root");
    } finally {
      setWorking(false);
    }
  };

  const runScan = async (rootId?: number) => {
    setWorking(true);
    try { await scan(rootId); } catch (requestError) { window.alert(requestError instanceof Error ? requestError.message : "Unable to start scan"); } finally { setWorking(false); }
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
              <h1 className="wordmark truncate">Audiobook Manager</h1>
              <p className="mt-0.5 truncate text-[12px] font-semibold text-ink3 tnum">
                {libraryBooks.length} {libraryBooks.length === 1 ? "title" : "titles"}
                {roots.length ? ` · ${roots.length} ${roots.length === 1 ? "folder" : "folders"}` : ""}
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
            <IconBtn label="Settings" onClick={() => setShowSettings(true)}>
              <BookOpen size={19} aria-hidden="true" />
            </IconBtn>
            {/*
              The refresh control reports what it is doing rather than making
              the shelf vanish. Spinning the icon and `aria-busy` are enough to
              say "working" without taking the books away from someone who was
              reading the list.
            */}
            <IconBtn
              label={refreshing ? "Refreshing library" : "Refresh library"}
              aria-busy={refreshing || undefined}
              onClick={() => void refresh()}
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
          aria-label="Sections"
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
            Offline — showing the {device.books.length} {device.books.length === 1 ? "book" : "books"} downloaded to this device.
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
                title="All audiobooks"
                count={`${searchedBooks.length} ${searchedBooks.length === 1 ? "title" : "titles"}${search.trim() ? " matching your search" : " in your library"}`}
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
                    Refreshing...
                  </span>
                )}
              </MachineHead>
              <StatusLegend className="mb-4" />
              {loading ? (
                /* Only reachable before the first response has ever arrived: the
                   hook latches `loading` false once anything has loaded, so a
                   refresh can never get here. */
                <div className="panel panel--sunk px-6 py-20 text-center text-ink2">Loading library...</div>
              ) : (
                <AudiobookGrid books={searchedBooks} {...gridProps} />
              )}
            </section>

            <section className="mt-12">
              <MachineHead title="Library folders" />
              <p className="text-[13.5px] text-ink2">
                Scan local folders to bring your audiobook metadata and artwork into one calm shelf.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Btn
                  variant="primary"
                  onClick={() => void runScan()}
                  disabled={working || !roots.length}
                >
                  <ScanLine size={18} aria-hidden="true" /> Scan library
                </Btn>
                <Btn variant="quiet" size="sm" onClick={() => setShowRootForm((visible) => !visible)}>
                  <FolderPlus size={17} aria-hidden="true" /> Add folder
                </Btn>
              </div>
              {showRootForm && (
                <form onSubmit={submitRoot} className="panel mb-4 grid gap-3 p-4 sm:grid-cols-[1fr_180px_auto]">
                  <input value={path} onChange={(event) => setPath(event.target.value)} placeholder="/data/audiobooks" required className="field" aria-label="Library folder path" />
                  <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Label (optional)" className="field" aria-label="Library folder label" />
                  <Btn type="submit" disabled={working}>Add folder</Btn>
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
                        <IconBtn label={`Scan ${root.label || root.path}`} onClick={() => void runScan(root.id)} disabled={working}>
                          <ScanLine size={16} aria-hidden="true" />
                        </IconBtn>
                        <IconBtn label={`Remove ${root.label || root.path}`} onClick={() => void removeRoot(root.id)}>
                          <Trash2 size={16} aria-hidden="true" />
                        </IconBtn>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="panel panel--sunk px-4 py-5 text-sm text-ink2">No folders configured yet.</p>
              )}
            </section>

            <div className="mt-8">
              {browse.enrichment && browse.enrichment.status !== "idle" && (
                <Notice className="mb-4">
                  Enrichment {browse.enrichment.status}: {browse.enrichment.processed}/{browse.enrichment.queued} checked ·{" "}
                  {browse.enrichment.applied} applied · {browse.enrichment.review} need review
                </Notice>
              )}

              <ReviewQueue books={browse.reviewQueue} onResolved={() => { void refresh(); void browse.refresh(); }} />
            </div>
          </>
        )}

        {tab === "browse" && (
          <>
            <section className="mb-7">
              <h2 className="text-[30px] leading-[1.05] sm:text-4xl">Browse</h2>
              <p className="mt-2 max-w-xl text-ink2">
                Grouped by genre and series, using the metadata your library was enriched with.
              </p>
            </section>

            <SearchBar value={search} onChange={onSearchChange} resultCount={filteredBooks.length} />
            <FilterBar books={libraryBooks} filters={filters} onChange={onFiltersChange} genres={browse.genres} />

            {isFilterActive(filters) || search.trim().length > 0 ? (
              <section>
                <MachineHead title="Filtered results" count={`${filteredBooks.length} ${filteredBooks.length === 1 ? "title" : "titles"}`} />
                <AudiobookGrid books={filteredBooks} {...gridProps} />
              </section>
            ) : (
              <>
                <Shelves shelves={genreShelves} onSelect={setSelectedBook} favouriteIds={favouriteIds} onToggleFavourite={toggleFavourite} emptyMessage="No genre shelves yet. Enrichment assigns genres from the curated taxonomy — check the review queue for books still unmatched." />
                {seriesShelves.length > 0 && (
                  <section className="mt-4">
                    <MachineHead title="Series" />
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

        {tab === "favourites" && (
          <section>
            <h2 className="text-[30px] leading-[1.05] sm:text-4xl">Favourites</h2>
            <p className="mb-6 mt-2 max-w-xl text-ink2">
              {favouriteIds.size === 0
                ? "Books you favourite are private to your profile and seed your Discover suggestions."
                : `${favouriteIds.size} ${favouriteIds.size === 1 ? "book" : "books"}, for this profile only.`}
            </p>
            <AudiobookGrid books={favouriteBooks} {...gridProps} />
          </section>
        )}
      </main>

      <footer className="relative z-10 px-5 pb-28 pt-6 text-center text-[12px] text-ink3 sm:pb-10">
        Audiobook Manager · local-first listening
      </footer>
      {selectedBook && <AudiobookDetail
        book={selectedBook}
        onClose={() => setSelectedBook(undefined)}
        onProgressSaved={() => setLibraryTick((tick) => tick + 1)}
        genres={browse.genres}
        tags={browse.tags}
        favourited={favouriteIds.has(selectedBook.id)}
        onToggleFavourite={toggleFavourite}
        onFindSimilar={findSimilar}
        onBookUpdated={() => { void refresh(); void browse.refresh(); }}
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
      />}

      {showSettings && (
        <Settings
          usedBytes={device.usedBytes}
          downloadedCount={device.books.length}
          offline={offline}
          onClose={() => setShowSettings(false)}
          onSaved={() => { void refresh(); void device.refresh(); }}
        />
      )}
    </div>
  );
}

export default App;