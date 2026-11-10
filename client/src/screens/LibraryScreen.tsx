import { RefreshCw, Server } from "lucide-react";
import type { Audiobook } from "../types";
import { AudiobookGrid, ContinueListening, inProgressBooks } from "../components/AudiobookGrid";
import { SearchBar } from "../components/SearchBar";
import { ReviewQueue } from "../components/ReviewQueue";
import { Btn, MachineHead, Notice, StatusLegend } from "../ui/primitives";
import { copy } from "../copy";
import { isNativeShell } from "../lib/platform";
import type { DeviceLibrary } from "../local/useDeviceLibrary";
import type { Tab } from "../useAppState";

export interface LibraryScreenProps {
  libraryBooks: Audiobook[];
  searchedBooks: Audiobook[];
  search: string;
  onSearchChange: (next: string) => void;
  loading: boolean;
  refreshing: boolean;
  offline: boolean;
  device: DeviceLibrary;
  recovering: boolean;
  recoverMessage?: string;
  onRecoverDownloads: () => void;
  onRetryOffline: () => void;
  onOpenServerSetup: () => void;
  onOpenTab: (tab: Tab) => void;
  onSelectBook: (book: Audiobook) => void;
  gridProps: {
    onSelect: (book: Audiobook) => void;
    favourites: Set<number>;
    onToggleFavourite: (bookId: number) => void;
    onFindSimilar: (book: Audiobook) => void;
    changedIds: Set<number>;
  };
  canManageLibrary: boolean;
  enrichment?: {
    status: string;
    processed: number;
    queued: number;
    applied: number;
    review: number;
  } | null;
  reviewQueue: Audiobook[];
  onReviewResolved: () => void;
}

export function LibraryScreen({
  libraryBooks,
  searchedBooks,
  search,
  onSearchChange,
  loading,
  refreshing,
  offline,
  device,
  recovering,
  recoverMessage,
  onRecoverDownloads,
  onRetryOffline,
  onOpenServerSetup,
  onOpenTab,
  onSelectBook,
  gridProps,
  canManageLibrary,
  enrichment,
  reviewQueue,
  onReviewResolved,
}: LibraryScreenProps) {
  return (
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
            <p className="mt-1 text-[12.5px]">{copy.offline.unclaimedOffline}</p>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Btn
                size="sm"
                variant="primary"
                disabled={recovering}
                onClick={onRecoverDownloads}
              >
                {recovering ? copy.offline.unclaimedFinding : copy.offline.unclaimedAction}
              </Btn>
              {recoverMessage && (
                <span className="text-[12.5px] font-bold">{recoverMessage}</span>
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
      <ContinueListening books={inProgressBooks(libraryBooks)} onSelect={onSelectBook} />
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
        {loading && !libraryBooks.length && !offline ? (
          /* Only reachable before the first response has ever arrived: the
             hook latches `loading` false once anything has loaded, so a
             refresh can never get here. */
          <div className="panel panel--sunk px-6 py-20 text-center text-ink2">{copy.shell.loadingLibrary}</div>
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
                <div className="grid justify-items-center gap-3">
                  <p className="max-w-sm text-sm text-ink2">{copy.offline.emptyIntro}</p>
                  <div className="flex flex-wrap justify-center gap-2">
                    <Btn variant="primary" size="sm" onClick={onRetryOffline}>
                      <RefreshCw size={15} aria-hidden="true" /> {copy.offline.tryAgain}
                    </Btn>
                    <Btn variant="quiet" size="sm" onClick={onOpenServerSetup}>
                      {copy.operator.serverSetup.changeAddress}
                    </Btn>
                  </div>
                </div>
              ) : (
                <Btn variant="quiet" size="sm" onClick={() => onOpenTab("server-library")}>
                  <Server size={15} aria-hidden="true" /> {copy.library.chooseBooks}
                </Btn>
              )
            }
            {...gridProps}
          />
        )}
      </section>

      {canManageLibrary && enrichment && enrichment.status !== "idle" && (
        <Notice className="mb-4">
          {copy.operator.enrichment.notice(
            enrichment.status,
            enrichment.processed,
            enrichment.queued,
            enrichment.applied,
            enrichment.review,
          )}
        </Notice>
      )}
      {canManageLibrary && <ReviewQueue books={reviewQueue} onResolved={onReviewResolved} />}
    </>
  );
}
