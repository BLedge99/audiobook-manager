import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Audiobook } from "../types";
import { FavouriteButton } from "./FavouriteButton";
import { seriesLabel, type Shelf } from "../lib/browse";

/**
 * Spec 20 — horizontally scrollable shelves.
 *
 * The grouping and ordering rules live in `lib/browse.ts` (pure, tested);
 * this component handles rendering and keyboard-scrolling only.
 */

function ShelfCard({
  book,
  onSelect,
  favourited,
  onToggleFavourite,
}: {
  book: Audiobook;
  onSelect: (book: Audiobook) => void;
  favourited?: boolean;
  onToggleFavourite?: () => void;
}) {
  return (
    <div className="group relative w-40 shrink-0 sm:w-44">
      <button onClick={() => onSelect(book)} className="w-full text-left">
        <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-slate-800">
          <img
            src={`/api/audiobooks/${book.id}/cover`}
            onError={(event) => { event.currentTarget.src = "/placeholder-cover.svg"; }}
            alt=""
            className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
          />
        </div>
        <h3 className="mt-2 truncate text-sm font-semibold text-slate-100">{book.title}</h3>
        <p className="truncate text-xs text-slate-400">{book.author}</p>
      </button>
      {onToggleFavourite && (
        <div className="absolute right-1.5 top-1.5">
          <FavouriteButton favourited={Boolean(favourited)} onToggle={onToggleFavourite} label={book.title} />
        </div>
      )}
    </div>
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
  // a way to page through without a trackpad.
  const scrollBy = (amount: number) => scroller.current?.scrollBy({ left: amount, behavior: "smooth" });

  return (
    <section className="mb-9" aria-labelledby={`shelf-${shelf.key}`}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id={`shelf-${shelf.key}`} className="text-lg font-semibold">
          {shelf.title}
        </h2>
        <div className="flex items-center gap-1">
          <span className="text-xs text-slate-500">{shelf.books.length}</span>
          <button
            type="button"
            onClick={() => scrollBy(-400)}
            aria-label={`Scroll ${shelf.title} left`}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={() => scrollBy(400)}
            aria-label={`Scroll ${shelf.title} right`}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div
        ref={scroller}
        className="flex gap-4 overflow-x-auto pb-2"
        role="group"
        aria-label={shelf.title}
        tabIndex={0}
      >
        {shelf.books.map((book) => (
          <div key={book.id} className="contents">
            <ShelfCard
              book={book}
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
      <div className="border border-dashed border-slate-700 bg-slate-900/60 px-6 py-14 text-center text-slate-400">
        {emptyMessage ?? "No shelves yet. Run a scan and enrichment to populate genres."}
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