import { useEffect, useState } from "react";
import { Check, Plus, Server, LoaderCircle } from "lucide-react";
import type { Audiobook } from "../types";
import { copy } from "../copy";
import { Btn, MachineHead, Notice, cn } from "../ui/primitives";
import { ShellCover } from "../ui/primitives";

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
}: {
  /** Every book the server has, each marked with `inLibrary`. */
  books: Audiobook[];
  loading: boolean;
  error?: string;
  /** Called when the tab is opened. */
  onLoad: () => void;
  /** Add a book to this profile's library. */
  onAdd: (bookId: number) => Promise<void>;
}) {
  const [pending, setPending] = useState<number>();
  const [failed, setFailed] = useState<string>();

  // Fetched when the tab opens rather than with the rest of the library: it is
  // a second copy of the shelf, and nothing else needs it.
  useEffect(() => {
    onLoad();
  }, [onLoad]);

  const add = async (bookId: number) => {
    setPending(bookId);
    setFailed(undefined);
    try {
      await onAdd(bookId);
    } catch (addError) {
      setFailed(addError instanceof Error ? addError.message : copy.errors.addToLibrary);
    } finally {
      setPending(undefined);
    }
  };

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
                />
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
}: {
  book: Audiobook;
  pending: boolean;
  onAdd: () => void;
}) {
  const inLibrary = Boolean(book.inLibrary);

  return (
    <li
      className={cn(
        // `min-w-0` is load-bearing. A grid item defaults to `min-width: auto`,
        // so the min-content width of the widest thing inside sets the item's
        // minimum -- and `truncate` means the title and the author are one
        // unbreakable line each. The author's name here is over 150 characters,
        // which made every row 1573px wide in a 392px viewport and sent the
        // whole page sideways.
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
        <span className="block truncate font-display text-[15px] font-semibold text-ink">
          {book.title}
        </span>
        <span className="block truncate text-[12.5px] text-ink2">{book.author}</span>
      </span>
      {inLibrary ? (
        <span className="flex shrink-0 items-center gap-1.5 text-[12px] font-bold text-mint-ink">
          <Check size={14} aria-hidden="true" />
          {copy.serverLibrary.inYourLibrary}
        </span>
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
    </li>
  );
}
