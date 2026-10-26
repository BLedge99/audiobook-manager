import { useEffect, useState } from "react";
import { Plus, Server, LoaderCircle, Trash2, HardDrive } from "lucide-react";
import type { Audiobook } from "../types";
import { copy } from "../copy";
import { describeFailure } from "../lib/api";
import { Btn, MachineHead, Notice, cn } from "../ui/primitives";
import { ShellCover } from "../ui/primitives";
import { RemoveFromLibraryQuestion, useRemoveFromLibrary } from "./removeFromLibrary";

/**
 * Spec 27 — the "Server library" tab.
 *
 * ## Why it is a tab and not a mode of the Library tab
 *
 * The two answer different questions: *what do I have?* and *what else is on
 * the server?* Collapsing them into one screen with a toggle makes the common
 * case — my own shelf — harder to read, to make the rare case possible.
 *
 * ## What it does not do
 *
 * It is not where listening happens. Adding a book here does not start a
 * download, and it does not mark anything as played. It changes one thing:
 * whether the book is in this profile's library.
 */
export function ServerLibrary({
  books,
  loading,
  error,
  onLoad,
  onAdd,
  onRemove,
  isDownloaded,
  onDeleteDownload,
  onOpen,
  offline,
  offlineBooks = [],
  onRemoveDevice,
}: {
  /** Every book the server has, each marked with `inLibrary`. */
  books: Audiobook[];
  loading: boolean;
  error?: string;
  /** Called when the tab is opened. */
  onLoad: () => void;
  /** Add a book to this profile's library. */
  onAdd: (bookId: number) => Promise<void>;
  /** Take a book out of this profile's library. */
  onRemove: (bookId: number) => Promise<void>;
  /**
   * Whether a book is downloaded to this device, which decides whether the
   * removal asks about deleting it.
   */
  isDownloaded?: (bookId: number) => boolean;
  /** Delete the device copy, freeing the space. */
  onDeleteDownload?: (bookId: number) => Promise<{ failed: string[] }>;
  /** Open the book, the way every other surface does. */
  onOpen?: (book: Audiobook) => void;
  /**
   * The server cannot be reached.
   *
   * The shelf is the server's, so offline there is nothing to add. But the tab
   * is not dead: the books on this device *are* your library while the server
   * is out of reach, and removing one of those needs no server at all.
   */
  offline?: boolean;
  /** The books on this device, shown instead of the shelf while offline. */
  offlineBooks?: Audiobook[];
  /** Remove a book from this device. The only removal available offline. */
  onRemoveDevice?: (bookId: number) => Promise<{ failed: string[] }>;
}) {
  const [pending, setPending] = useState<number>();
  const [failed, setFailed] = useState<string>();

  // Fetched when the tab opens rather than with the rest of the library: it is
  // a second copy of the shelf, and nothing else needs it.
  //
  // Not while offline. A request that is known to fail is a request that
  // should not be made, and the error it produced was the whole of what the
  // tab had to say. `offline` is in the dependencies, so the shelf is fetched
  // the moment the server comes back.
  useEffect(() => {
    if (offline) return;
    onLoad();
  }, [onLoad, offline]);

  const add = async (bookId: number) => {
    setPending(bookId);
    setFailed(undefined);
    try {
      await onAdd(bookId);
    } catch (addError) {
      setFailed(describeFailure(addError, copy.errors.addToLibrary));
    } finally {
      setPending(undefined);
    }
  };

  // Offline, the shelf is unreachable and the tab shows what is on the device
  // instead. See `OfflineServerLibrary` for why that is the same list the
  // Library tab is showing.
  if (offline) {
    return (
      <OfflineServerLibrary
        books={offlineBooks}
        onRemove={onRemoveDevice}
        onOpen={onOpen}
      />
    );
  }

  const held = books.filter((book) => book.inLibrary).length;

  return (
    <div className="space-y-7">
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-[30px] leading-[1.05] sm:text-4xl">
              <Server size={26} className="text-rasp" aria-hidden="true" /> {copy.serverLibrary.heading}
            </h2>
            <p className="mt-2 text-ink2">{copy.serverLibrary.intro}</p>
          </div>
        </div>

        {error && <Notice tone="error" role="alert" className="mb-4">{error}</Notice>}
        {failed && <Notice tone="error" role="alert" className="mb-4">{failed}</Notice>}

        {loading && !books.length ? (
          <div className="panel panel--sunk flex items-center justify-center gap-2 px-6 py-16 text-ink2">
            <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />
            {copy.serverLibrary.loading}
          </div>
        ) : error && !books.length ? (
          /* The fetch failed, so we do not know what the server has. Saying
             "no audiobooks have been added yet" would be a lie -- it is the
             empty shelf talking, and the shelf was never read. The error above
             is the whole of what is known. */
          null
        ) : books.length === 0 ? (
          <div className="panel panel--sunk px-6 py-14 text-center text-ink2">
            {copy.serverLibrary.empty}
          </div>
        ) : (
          <>
            <MachineHead
              title={copy.serverLibrary.allAudiobooks}
              count={copy.serverLibrary.heldCount(held, books.length)}
            />
            <ul className="grid gap-2 sm:grid-cols-2">
              {books.map((book) => (
                <ServerLibraryRow
                  key={book.id}
                  book={book}
                  pending={pending === book.id}
                  onAdd={() => void add(book.id)}
                  onRemove={onRemove}
                  isDownloaded={isDownloaded}
                  onDeleteDownload={onDeleteDownload}
                  onOpen={onOpen}
                />
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

/**
 * The tab, offline.
 *
 * ## Why this shows the device's books
 *
 * The shelf belongs to the server, and offline it is out of reach -- there is
 * genuinely nothing to add. But the tab does not have to be dead for that.
 *
 * While the server cannot be reached, the app's library *is* the books on this
 * device: that is what the Library tab is showing, and what the offline banner
 * says. So the "All books" tab falls back to the same list, and the one thing
 * a person can still do with it -- take a book away -- is the one thing that
 * needs no server. Removing a download is a local operation, and it is the
 * removal the household asked for.
 *
 * ## What it does not do
 *
 * It does not pretend the removal happened on the server. Membership lives
 * there, and a change to it needs a connection; what happens here is the
 * removal the app can actually carry out.
 */
function OfflineServerLibrary({
  books,
  onRemove,
  onOpen,
}: {
  books: Audiobook[];
  onRemove?: (bookId: number) => Promise<{ failed: string[] }>;
  onOpen?: (book: Audiobook) => void;
}) {
  const [busy, setBusy] = useState<number>();
  const [failed, setFailed] = useState<string>();

  const remove = async (bookId: number) => {
    setBusy(bookId);
    setFailed(undefined);
    try {
      const result = await onRemove?.(bookId);
      if (result && result.failed.length > 0) {
        setFailed(copy.download.removedWithErrors(result.failed.length));
      }
    } catch (removalError) {
      setFailed(removalError instanceof Error ? removalError.message : copy.download.removeFailed);
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="space-y-7">
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-[30px] leading-[1.05] sm:text-4xl">
              <HardDrive size={26} className="text-rasp" aria-hidden="true" /> {copy.serverLibrary.offlineHeading}
            </h2>
            <p className="mt-2 text-ink2">{copy.serverLibrary.offlineIntro}</p>
          </div>
        </div>

        {failed && <Notice tone="error" role="alert" className="mb-4">{failed}</Notice>}

        {books.length === 0 ? (
          <div className="panel panel--sunk px-6 py-14 text-center text-ink2">
            {copy.serverLibrary.offlineEmpty}
          </div>
        ) : (
          <>
            <MachineHead
              title={copy.serverLibrary.onThisDevice}
              count={copy.serverLibrary.offlineCount(books.length)}
            />
            <ul className="grid gap-2 sm:grid-cols-2">
              {books.map((book) => (
                <li key={book.id} className="min-w-0">
                  <div className="panel flex min-w-0 items-center gap-3 p-2">
                    <span className="w-12 shrink-0">
                      <ShellCover bookId={book.id} className="w-full" />
                    </span>
                    <span className="min-w-0 flex-1">
                      {/* The title opens the book, the way it does everywhere
                          else. A row you cannot tap is a dead end. */}
                      <button
                        type="button"
                        onClick={() => onOpen?.(book)}
                        className="block w-full min-w-0 truncate text-left font-display text-[15px] font-semibold text-ink"
                      >
                        {book.title}
                      </button>
                      <span className="block truncate text-[12.5px] text-ink2">{book.author}</span>
                    </span>
                    {/* The trash can, because this one really does delete: the
                        file goes with it. The book page says the same thing in
                        words ("Remove from device"), and the two mean the same
                        thing here. */}
                    <Btn
                      size="sm"
                      variant="quiet"
                      className="shrink-0 text-rasp-ink"
                      onClick={() => void remove(book.id)}
                      disabled={busy === book.id}
                      aria-label={`${copy.download.removeFromDevice}: ${book.title}`}
                    >
                      {busy === book.id ? (
                        <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />
                      ) : (
                        <Trash2 size={13} aria-hidden="true" />
                      )}
                      {copy.removeBook.remove}
                    </Btn>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

function ServerLibraryRow({
  book,
  pending,
  onAdd,
  onRemove,
  isDownloaded,
  onDeleteDownload,
  onOpen,
}: {
  book: Audiobook;
  pending: boolean;
  onAdd: () => void;
  onRemove: (bookId: number) => Promise<void>;
  isDownloaded?: (bookId: number) => boolean;
  onDeleteDownload?: (bookId: number) => Promise<{ failed: string[] }>;
  onOpen?: (book: Audiobook) => void;
}) {
  const inLibrary = Boolean(book.inLibrary);
  const downloaded = Boolean(isDownloaded?.(book.id));

  // The same removal question the book page asks, from the same code. A list
  // that shows which books you have has to let you change that, or it is a
  // dead end.
  const removal = useRemoveFromLibrary({
    bookId: book.id,
    isDownloaded: downloaded,
    onRemove,
    onDeleteDownload,
  });

  return (
    <li className="min-w-0">
      <div
        className={cn(
          // `min-w-0` is load-bearing. A grid item defaults to `min-width: auto`,
          // so the min-content width of the widest thing inside sets the item's
          // minimum -- and `truncate` means the title and the author are one
          // unbreakable line each. The author's name here is over 150
          // characters, which made every row 1573px wide in a 392px viewport
          // and sent the whole page sideways.
          //
          // `min-w-0` on the inner flex child is not enough on its own: it
          // lowers the child's minimum, not the grid track's.
          "panel flex min-w-0 items-center gap-3 p-2",
          inLibrary && "ring-2 ring-mint",
        )}
      >
        <span className="w-12 shrink-0">
          <ShellCover bookId={book.id} className="w-full" />
        </span>
        <span className="min-w-0 flex-1">
          {/* The title is the button that opens the book, the way every other
              surface does. A row you cannot tap is a dead end -- the
              household tapped a book here and nothing happened. It is a button
              in its own right rather than a button wrapping the row, because
              the Remove button beside it must not be nested inside it. */}
          <button
            type="button"
            onClick={() => onOpen?.(book)}
            className="block w-full min-w-0 truncate text-left font-display text-[15px] font-semibold text-ink"
          >
            {book.title}
          </button>
          <span className="block truncate text-[12.5px] text-ink2">{book.author}</span>
        </span>
        {inLibrary ? (
          <Btn
            size="sm"
            variant="quiet"
            className="shrink-0 text-rasp-ink"
            onClick={() => removal.start()}
            aria-label={`${copy.removeBook.action}: ${book.title}`}
          >
            {copy.removeBook.remove}
          </Btn>
        ) : (
          <Btn size="sm" variant="primary" onClick={onAdd} disabled={pending} className="shrink-0">
            {pending ? (
              <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />
            ) : (
              <Plus size={13} aria-hidden="true" />
            )}
            {copy.serverLibrary.add}
          </Btn>
        )}
      </div>

      {/* The question goes below the row: a 360px phone has no width for a
          two-answer question beside a title. */}
      <RemoveFromLibraryQuestion
        asking={removal.asking}
        busy={removal.busy}
        error={removal.error}
        hasDownload={downloaded}
        onKeepDownload={() => void removal.confirm(false)}
        onDeleteDownload={() => void removal.confirm(true)}
        onCancel={removal.cancel}
      />
    </li>
  );
}
