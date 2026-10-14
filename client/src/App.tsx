import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, Compass, FolderPlus, Heart, Library, LayoutGrid, LoaderCircle, RefreshCw, ScanLine, Settings as SettingsIcon, Trash2, WifiOff } from "lucide-react";
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
import type { Audiobook } from "./types";

type Tab = "library" | "browse" | "discover" | "favourites";

const TABS: { id: Tab; label: string; icon: typeof Library }[] = [
  { id: "library", label: "Library", icon: Library },
  { id: "browse", label: "Browse", icon: LayoutGrid },
  { id: "discover", label: "Discover", icon: Compass },
  { id: "favourites", label: "Favourites", icon: Heart },
];

function App() {
  const { audiobooks, roots, loading, error, refresh, addRoot, removeRoot, scan } = useLibrary();
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
  };

  /**
   * Progress saved while a book was open has to reach the library grid, which
   * otherwise keeps whatever `progress` it fetched at page load. This fires
   * from the player's final save, so the refetch happens *after* the write
   * rather than racing it.
   *
   * Also refetch when the tab is focused or becomes visible again: the same
   * staleness appears when listening happened on another device.
   */
  const [libraryTick, setLibraryTick] = useState(0);
  useEffect(() => {
    if (!libraryTick || !profileId) return;
    void refresh({ silent: true });
  }, [libraryTick, profileId, refresh]);

  useEffect(() => {
    if (!profileId) return;
    const refetch = () => { void refresh({ silent: true }); };
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
    <div className="min-h-screen bg-[#0b1117] text-slate-100">
      <header className="border-b border-slate-800/80 bg-[#0b1117]/95">
        {/* `flex-wrap` + `min-w-0` are load-bearing. The right-hand group
            (settings, refresh, profile switcher) has a fixed intrinsic width of
            about 324px and the title refuses to shrink, so on a 360px phone the
            row was forced to 515px and the whole page scrolled sideways. Wrapping
            drops the controls to their own line instead. `e2e/phone-layout`
            asserts the document never exceeds the viewport, so this cannot
            silently come back. */}
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5 sm:py-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center bg-cyan-400 text-slate-950"><BookOpen size={22} /></span>
            <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-400">Local library</p><h1 className="truncate text-lg font-bold sm:text-xl">Audiobook Manager</h1></div>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <button onClick={() => setShowSettings(true)} aria-label="Settings" className="rounded-full p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><SettingsIcon size={20} /></button>
            <button onClick={() => void refresh()} aria-label="Refresh library" className="rounded-full p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><RefreshCw size={20} /></button>
            <ProfileSwitcher />
          </div>
        </div>
        <nav className="mx-auto max-w-7xl px-4 sm:px-5" aria-label="Sections">
          <ul className="flex flex-wrap gap-1">
            {TABS.map(({ id, label: tabLabel, icon: Icon }) => (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => openTab(id)}
                  aria-current={tab === id ? "page" : undefined}
                  className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm transition ${
                    tab === id ? "border-cyan-400 text-white" : "border-transparent text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Icon size={15} aria-hidden="true" />
                  {tabLabel}
                  {id === "favourites" && favouriteIds.size > 0 && (
                    <span className="rounded-full bg-slate-800 px-1.5 text-xs text-slate-300">{favouriteIds.size}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-10">
        {error && !offline && <div className="mb-6 border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</div>}

        {offline && (
          <div className="mb-6 flex items-center gap-2 border border-amber-900/60 bg-amber-950/20 px-4 py-3 text-sm text-amber-200" role="status">
            <WifiOff size={16} aria-hidden="true" />
            Offline — showing the {device.books.length} {device.books.length === 1 ? "book" : "books"} downloaded to this device.
          </div>
        )}

        {tab === "library" && (
          <>
            <section className="mb-10 flex flex-col justify-between gap-5 border-b border-slate-800 pb-8 sm:flex-row sm:items-end">
              <div><p className="mb-2 text-sm font-medium text-cyan-400">Your collection</p><h2 className="text-4xl font-bold tracking-tight">Browse your books.</h2><p className="mt-3 max-w-xl text-slate-400">Scan local folders to bring your audiobook metadata and artwork into one calm shelf.</p></div>
              <button onClick={() => void runScan()} disabled={working || !roots.length} className="flex items-center justify-center gap-2 bg-cyan-400 px-5 py-3 font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"><ScanLine size={18} /> Scan library</button>
            </section>

            <section className="mb-10">
              <div className="mb-4 flex items-center justify-between"><h2 className="flex items-center gap-2 text-lg font-semibold"><Library size={19} className="text-cyan-400" /> Library folders</h2><button onClick={() => setShowRootForm((visible) => !visible)} className="flex items-center gap-2 text-sm text-cyan-400 hover:text-cyan-300"><FolderPlus size={17} /> Add folder</button></div>
              {showRootForm && <form onSubmit={submitRoot} className="mb-4 grid gap-3 border border-slate-800 bg-slate-900 p-4 sm:grid-cols-[1fr_180px_auto]"><input value={path} onChange={(event) => setPath(event.target.value)} placeholder="/data/audiobooks" required className="border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-cyan-400" /><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Label (optional)" className="border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-cyan-400" /><button disabled={working} className="bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-white">Add folder</button></form>}
              {roots.length ? <div className="grid gap-3 md:grid-cols-2">{roots.map((root) => <div key={root.id} className="flex items-center justify-between border border-slate-800 bg-slate-900/70 px-4 py-3"><div className="min-w-0"><p className="truncate font-medium">{root.label || root.path}</p><p className="truncate text-xs text-slate-500">{root.path} {root.scanState?.status && `· ${root.scanState.status}`}</p>{root.scanState?.message && <p className="mt-1 text-xs text-red-300">{root.scanState.message}</p>}</div><div className="ml-3 flex items-center gap-1"><button onClick={() => void runScan(root.id)} disabled={working} aria-label={`Scan ${root.label || root.path}`} className="rounded p-2 text-cyan-400 hover:bg-slate-800"><ScanLine size={16} /></button><button onClick={() => void removeRoot(root.id)} aria-label={`Remove ${root.label || root.path}`} className="rounded p-2 text-slate-500 hover:bg-slate-800 hover:text-red-400"><Trash2 size={16} /></button></div></div>)}</div> : <p className="text-sm text-slate-500">No folders configured yet.</p>}
            </section>

            {browse.enrichment && browse.enrichment.status !== "idle" && (
              <p className="mb-6 border border-slate-800 bg-slate-900/60 px-4 py-2 text-xs text-slate-400">
                Enrichment {browse.enrichment.status}: {browse.enrichment.processed}/{browse.enrichment.queued} checked · {browse.enrichment.applied} applied · {browse.enrichment.review} need review
              </p>
            )}

            <ReviewQueue books={browse.reviewQueue} onResolved={() => { void refresh({ silent: true }); void browse.refresh(); }} />

            <ContinueListening books={inProgressBooks(libraryBooks)} onSelect={setSelectedBook} />
            <SearchBar value={search} onChange={onSearchChange} resultCount={searchedBooks.length} />
            <section>
              <div className="mb-5 flex items-center justify-between"><div><h2 className="text-2xl font-bold">All audiobooks</h2><p className="mt-1 text-sm text-slate-500">{searchedBooks.length} {searchedBooks.length === 1 ? "title" : "titles"}{search.trim() ? " matching your search" : " in your library"}</p></div>{working && <LoaderCircle className="animate-spin text-cyan-400" size={20} />}</div>
              {loading ? <div className="py-20 text-center text-slate-500">Loading library...</div> : <AudiobookGrid books={searchedBooks} {...gridProps} />}
            </section>
          </>
        )}

        {tab === "browse" && (
          <>
            <section className="mb-8">
              <h2 className="text-2xl font-bold">Browse</h2>
              <p className="mt-1 text-sm text-slate-500">Grouped by genre and series, using the metadata your library was enriched with.</p>
            </section>

            <SearchBar value={search} onChange={onSearchChange} resultCount={filteredBooks.length} />
            <FilterBar books={libraryBooks} filters={filters} onChange={onFiltersChange} genres={browse.genres} />

            {isFilterActive(filters) || search.trim().length > 0 ? (
              <section>
                <div className="mb-5">
                  <h3 className="text-xl font-bold">Filtered results</h3>
                  <p className="mt-1 text-sm text-slate-500">{filteredBooks.length} {filteredBooks.length === 1 ? "title" : "titles"}</p>
                </div>
                <AudiobookGrid books={filteredBooks} {...gridProps} />
              </section>
            ) : (
              <>
                <Shelves shelves={genreShelves} onSelect={setSelectedBook} favouriteIds={favouriteIds} onToggleFavourite={toggleFavourite} emptyMessage="No genre shelves yet. Enrichment assigns genres from the curated taxonomy — check the review queue for books still unmatched." />
                {seriesShelves.length > 0 && (
                  <section className="mt-4">
                    <h3 className="mb-4 text-xl font-bold">Series</h3>
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
            <h2 className="mb-1 text-2xl font-bold">Favourites</h2>
            <p className="mb-6 text-sm text-slate-500">
              {favouriteIds.size === 0
                ? "Books you favourite are private to your profile and seed your Discover suggestions."
                : `${favouriteIds.size} ${favouriteIds.size === 1 ? "book" : "books"}, for this profile only.`}
            </p>
            <AudiobookGrid books={favouriteBooks} {...gridProps} />
          </section>
        )}
      </main>

      <footer className="border-t border-slate-800 px-5 py-6 text-center text-xs text-slate-600">Audiobook Manager · local-first listening</footer>
      {selectedBook && <AudiobookDetail
        book={selectedBook}
        onClose={() => setSelectedBook(undefined)}
        onProgressSaved={() => setLibraryTick((tick) => tick + 1)}
        genres={browse.genres}
        tags={browse.tags}
        favourited={favouriteIds.has(selectedBook.id)}
        onToggleFavourite={toggleFavourite}
        onFindSimilar={findSimilar}
        onBookUpdated={() => { void refresh({ silent: true }); void browse.refresh(); }}
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