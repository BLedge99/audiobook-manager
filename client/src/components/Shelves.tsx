import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Audiobook } from "../types";
import { FavouriteButton } from "./FavouriteButton";
import { seriesLabel, type Shelf } from "../lib/browse";
import { copy, plural } from "../copy";
import { CapsuleMarks, MachineHead, ShellCover, cn } from "../ui/primitives";

/**
 * Spec 20 -- horizontally scrollable shelves.
 *
 * The grouping and ordering rules live in `lib/browse.ts` (pure, tested);
 * this component handles rendering and keyboard-scrolling only.
 *
 * A book must look like the same object wherever it appears, so a shelf card
 * uses the same capsule shell as the library grid rather than a second style
 * for the same thing.
 */

function ShelfCard({
  book,
  index,
  onSelect,
  favourited,
  onToggleFavourite,
}: {
  book: Audiobook;
  index: number;
  onSelect: (book: Audiobook) => void;
  favourited?: boolean;
  onToggleFavourite?: () => void;
}) {
  return (
    <article className={cn("capsule group relative w-[136px] shrink-0 p-2 sm:w-[168px]", index % 2 && "capsule--alt")}>
      <button onClick={() => onSelect(book)} className="block w-full text-left">
        <span className="relative block">
          <ShellCover bookId={book.id} className="w-full" />
          <CapsuleMarks />
        </span>
        <h3 className="mt-2 line-clamp-2 min-h-[2.3em] font-display text-[13.5px] font-semibold leading-tight text-ink">
          {book.title}
        </h3>
        <p className="truncate text-[11.5px] text-ink2">{book.author}</p>
      </button>
      {onToggleFavourite && (
        <div className="absolute right-3 top-3 max-sm:opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:focus-within:opacity-100">
          <FavouriteButton favourited={Boolean(favourited)} onToggle={onToggleFavourite} label={book.title} />
        </div>
      )}
    </article>
  );
}

export function ShelfRow({
  shelf,
  onSelect,
  favouriteIds,
  onToggleFavourite,
  showSeriesLabel,
}: {
  shelf: Shelf;
  onSelect: (book: Audiobook) => void;
  favouriteIds: Set<number>;
  onToggleFavourite: (bookId: number) => void;
  showSeriesLabel?: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);

  // Shelves scroll horizontally; these give keyboard users and desktop users
  // a way to page through without a trackpad. Hidden from touch, where the rail
  // is already swipeable and an arrow button just eats a third of the row.
  const scrollBy = (amount: number) => scroller.current?.scrollBy({ left: amount, behavior: "smooth" });

  return (
    <section className="mb-9" aria-labelledby={`shelf-${shelf.key}`}>
      <MachineHead
        id={`shelf-${shelf.key}`}
        title={shelf.title}
        count={plural(shelf.books.length, "book")}
      >
        <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
          <button
            type="button"
            onClick={() => scrollBy(-400)}
            aria-label={copy.browse.scrollLeft(shelf.title)}
            className="iconbtn size-9"
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => scrollBy(400)}
            aria-label={copy.browse.scrollRight(shelf.title)}
            className="iconbtn size-9"
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </MachineHead>

      {/* Bleeds to the screen edge on a phone so a shelf reads as continuing
          rather than as a boxed list that happens to be cut off. */}
      <div
        ref={scroller}
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0"
        role="group"
        aria-label={shelf.title}
        tabIndex={0}
      >
        {shelf.books.map((book, index) => (
          <div key={book.id} className="contents">
            <ShelfCard
              book={book}
              index={index}
              onSelect={onSelect}
              favourited={favouriteIds.has(book.id)}
              onToggleFavourite={() => onToggleFavourite(book.id)}
            />
            {showSeriesLabel && seriesLabel(book, shelf.books.length) && (
              <span className="sr-only">{seriesLabel(book, shelf.books.length)}</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export function Shelves({
  shelves,
  onSelect,
  favouriteIds,
  onToggleFavourite,
  emptyMessage,
}: {
  shelves: Shelf[];
  onSelect: (book: Audiobook) => void;
  favouriteIds: Set<number>;
  onToggleFavourite: (bookId: number) => void;
  emptyMessage?: string;
}) {
  if (shelves.length === 0) {
    return (
      <div className="panel panel--sunk px-6 py-14 text-center text-ink2">
        {emptyMessage ?? copy.browse.noShelves}
      </div>
    );
  }

  return (
    <div>
      {shelves.map((shelf) => (
        <ShelfRow
          key={shelf.key}
          shelf={shelf}
          onSelect={onSelect}
          favouriteIds={favouriteIds}
          onToggleFavourite={onToggleFavourite}
          showSeriesLabel={shelf.key.startsWith("series:")}
        />
      ))}
    </div>
  );
}