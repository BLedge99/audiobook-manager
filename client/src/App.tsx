import { Settings as GearIcon, RefreshCw, WifiOff } from "lucide-react";
import { AudiobookDetail } from "./components/AudiobookDetail";
import { Discover } from "./components/Discover";
import { needsServerUrl, getActiveProfileId } from "./lib/api";
import { AccountGate } from "./components/AccountGate";
import { OfflineNotice, Splash } from "./components/OfflineNotice";
import { OfflineUnlock } from "./components/OfflineUnlock";
import { ProfileGate } from "./components/ProfileGate";
import { ServerSetup } from "./components/ServerSetup";
import { ProfileSwitcher } from "./components/ProfileSwitcher";
import { AccountMenu } from "./components/AccountMenu";
import { ServerLibrary } from "./components/ServerLibrary";
import { isNativeShell } from "./lib/platform";
import { clearCoverCache, coverCacheBytes } from "./local/CoverImage";
import { Settings } from "./components/Settings";
import { DownloadButton } from "./components/DownloadButton";
import { copy } from "./copy";
import { Specks, ThemeToggle, Notice, IconBtn, cn } from "./ui/primitives";
import { useAppState } from "./useAppState";
import { LibraryScreen } from "./screens/LibraryScreen";
import { BrowseScreen } from "./screens/BrowseScreen";
import { FavouritesScreen } from "./screens/FavouritesScreen";
import { ConnectionStatus } from "./components/ConnectionStatus";

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

/**
 * Composition root for the client application.
 *
 * Wire together top-level app state (`useAppState`), gates (server setup, splash,
 * offline unlock, authentication, profile selection), shell layout, and screens
 * (`LibraryScreen`, `BrowseScreen`, `FavouritesScreen`, `Discover`, `ServerLibrary`).
 *
 * Preserves ADR 012 player-first ordering and ADR 017 position model.
 */
function App() {
  const app = useAppState();
  const {
    session,
    accountExperience,
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
    showServerSetup,
    bypassServerSetup,
    serverReachable,
    activeProfileId,
    playerProfileId,
    setProfileId,
    setOfflineUnlocked,
    setSkippedUnlock,
    filters,
    search,
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
    reconnect,
    offlineMode,
  } = app;

  if ((needsServerUrl() || showServerSetup) && !bypassServerSetup) {
    return (
      <ServerSetup
        onDone={() => window.location.reload()}
        onContinueOffline={isNativeShell() ? handleContinueOffline : undefined}
      />
    );
  }

  // Still deciding whether the server is there.
  if (serverReachable === undefined) return <Splash />;

  if (screen?.kind === "waiting" && device.loading) return <Splash />;

  if (screen?.kind === "libraryReadFailed") {
    return (
      <OfflineNotice
        hasBooks={device.books.length > 0}
        libraryReadFailed
        onRetry={retryOffline}
        onChangeServer={openServerSetup}
      />
    );
  }

  if (screen?.kind === "unlock" && device.books.length === 0) {
    return (
      <OfflineUnlock
        onUnlocked={() => {
          setOfflineUnlocked(true);
          void device.refresh();
          void browse.refresh();
        }}
        onChangeServer={openServerSetup}
        onListenWithoutProgress={() => setSkippedUnlock(true)}
      />
    );
  }

  if (screen?.kind === "shell" && device.books.length === 0 && !isNativeShell()) {
    return <OfflineNotice hasBooks={false} onRetry={retryOffline} onChangeServer={openServerSetup} />;
  }

  if (serverReachable && authed === false) {
    return (
      <AccountGate
        accountExperience={accountExperience}
        onSuccess={() => {
          setProfileId(accountExperience === "demo" ? null : getActiveProfileId());
          void (async () => {
            await refresh();
            await probeServer();
          })();
        }}
        onContinueOffline={isNativeShell() ? handleContinueOffline : undefined}
      />
    );
  }

  if (serverReachable && authed && !session) return <Splash />;

  if (serverReachable && authed && !activeProfileId && accountExperience !== "demo") {
    return (
      <ProfileGate
        onSuccess={() => setProfileId(getActiveProfileId())}
        onContinueOffline={isNativeShell() ? handleContinueOffline : undefined}
      />
    );
  }

  return (
    <div className="relative min-h-dvh bg-ground text-ink">
      <Specks />
      <header className="bar">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Mark />
            <div className="min-w-0 flex-1">
              <h1 className="wordmark truncate">{copy.brand.name}</h1>
              <p className="mt-0.5 truncate text-[12px] font-semibold text-ink3 tnum">
                {copy.shell.libraryCount(libraryBooks.length, roots.length)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:ml-auto">
            <ConnectionStatus offlineMode={offlineMode} serverReachable={serverReachable} />
            <ThemeToggle />
            <IconBtn label={copy.shell.settings} onClick={() => setShowSettings(true)}>
              <GearIcon size={19} aria-hidden="true" />
            </IconBtn>
            <IconBtn
              label={refreshing ? copy.shell.refreshing : copy.shell.refresh}
              aria-busy={refreshing || undefined}
              onClick={refreshEverything}
            >
              <RefreshCw size={19} className={refreshing ? "animate-spin" : ""} aria-hidden="true" />
            </IconBtn>
            {!offline && (accountExperience === "demo" ? <AccountMenu session={session} /> : <ProfileSwitcher />)}
          </div>
        </div>

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
                    "flex w-full flex-col items-center justify-center gap-1 rounded-[16px_13px_16px_13px/13px_16px_13px_16px] px-2 py-2 text-[11px] font-bold transition sm:flex-row sm:gap-2 sm:px-4 sm:py-2.5 sm:text-[13.5px]",
                    shownTab === id
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

      <main className="relative z-10 mx-auto w-full max-w-7xl px-4 pb-28 pt-7 sm:px-6 sm:pb-14 sm:pt-9">
        {error && !offline && (
          <Notice tone="error" role="alert" className="mb-6">
            {error}
          </Notice>
        )}

        {offline && device.books.length > 0 && (
          <Notice tone="warn" role="status" icon={<WifiOff size={16} aria-hidden="true" />} className="mb-6">
            <p>{copy.shell.offlineBanner(device.books.length)}</p>
            <p className="mt-1 text-[12.5px]">{copy.shell.offlineBannerHint}</p>
          </Notice>
        )}

        {offline && !progressAvailable && device.books.length > 0 && (
          <Notice tone="warn" role="status" className="mb-6">
            {copy.offline.progressNotSaved}
          </Notice>
        )}

        {shownTab === "library" && (
          <LibraryScreen
            libraryBooks={libraryBooks}
            searchedBooks={searchedBooks}
            search={search}
            onSearchChange={onSearchChange}
            loading={loading}
            refreshing={refreshing}
            offline={offline}
            device={device}
            recovering={recovering}
            recoverMessage={recoverMessage}
            onRecoverDownloads={() => void recoverDownloads()}
            onRetryOffline={retryOffline}
            onOpenServerSetup={openServerSetup}
            onOpenTab={openTab}
            onSelectBook={setSelectedBook}
            gridProps={gridProps}
            canManageLibrary={canManageLibrary}
            enrichment={browse.enrichment}
            reviewQueue={browse.reviewQueue}
            onReviewResolved={() => { void refresh(); void browse.refresh(); }}
          />
        )}

        {shownTab === "browse" && (
          <BrowseScreen
            libraryBooks={libraryBooks}
            filteredBooks={filteredBooks}
            filters={filters}
            onFiltersChange={onFiltersChange}
            search={search}
            onSearchChange={onSearchChange}
            genres={browse.genres}
            tags={browse.tags}
            genreShelves={genreShelves}
            seriesShelves={seriesShelves}
            favouriteIds={favouriteIds}
            onToggleFavourite={toggleFavourite}
            onSelectBook={setSelectedBook}
            gridProps={gridProps}
            accountExperience={accountExperience}
            onTagChanged={() => void browse.refresh()}
          />
        )}

        {shownTab === "discover" && <Discover discover={discover} hasFavourites={favouriteIds.size > 0} />}

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
            offline={offline}
            offlineBooks={device.books}
            onRemoveDevice={isNativeShell() ? device.remove : undefined}
          />
        )}

        {shownTab === "favourites" && (
          <FavouritesScreen
            favouriteIds={favouriteIds}
            favouriteBooks={favouriteBooks}
            gridProps={gridProps}
          />
        )}
      </main>

      <footer className="relative z-10 px-5 pb-28 pt-6 text-center text-[12px] text-ink3 sm:pb-10">
        {copy.brand.footer}
      </footer>

      {selectedBook && (
        <AudiobookDetail
          book={selectedBook}
          onClose={() => setSelectedBook(undefined)}
          onProgressSaved={() => {
            setLibraryTick((tick) => tick + 1);
            void device.refresh();
          }}
          genres={browse.genres}
          tags={browse.tags}
          favourited={favouriteIds.has(selectedBook.id)}
          onToggleFavourite={toggleFavourite}
          onFindSimilar={findSimilar}
          onBookUpdated={() => { void refresh(); void browse.refresh(); }}
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
        />
      )}

      {showSettings && (
        <Settings
          usedBytes={device.usedBytes}
          downloadedCount={device.books.length}
          offline={offline}
          coverBytes={coverCacheBytes()}
          offlineMode={offlineMode}
          onReconnect={reconnect}
          onClearCovers={async () => { await clearCoverCache(); }}
          onClose={() => setShowSettings(false)}
          onSaved={() => { void refresh(); void device.refresh(); }}
        />
      )}
    </div>
  );
}

export default App;