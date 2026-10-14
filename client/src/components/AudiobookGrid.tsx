import { Clock3, Compass, Headphones } from "lucide-react";
import type { Audiobook } from "../types";
import { coverUrl } from "../lib/api";
import { FavouriteButton } from "./FavouriteButton";
import {
  describePosition,
  hasProgress,
  parseSegments,
  remainingLabel,
  timeLabel,
  totalDuration,
} from "../lib/position";

function durationLabel(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/**
 * One line describing where a book is: which chapter, how far in, and how much
 * is left. Falls back to whole-book progress for books with no chapters.
 */
export function describeBookProgress(book: Audiobook): { line: string; percent: number } {
  const { segments, kind } = parseSegments(book);
  const total = totalDuration(book, segments);
  const position = book.progress?.position ?? 0;
  const described = describePosition(segments, position, kind, total);
  const parts: string[] = [];
  if (segments.length > 1) {
    parts.push(`${described.heading}${described.title ? ` · ${described.title}` : ""}`);
    parts.push(`${timeLabel(described.segmentElapsed)} in`);
  }
  parts.push(remainingLabel(described.bookRemaining));
  return { line: parts.join(" · "), percent: described.bookPercent };
}

/** Books with a saved position worth resuming, most recently played first. */
export function inProgressBooks(books: Audiobook[]): Audiobook[] {
  return books
    .filter((book) => hasProgress(book.progress?.position, book.duration))
    .sort((a, b) => {
      const left = Date.parse(a.progress?.lastPlayed ?? "") || 0;
      const right = Date.parse(b.progress?.lastPlayed ?? "") || 0;
      return right - left;
    });
}

const cardGrid = "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";

function Cover({ book }: { book: Audiobook }) {
  return (
    <div className="relative aspect-[2/3] overflow-hidden bg-slate-800">
      <img src={coverUrl(book.id)} onError={(event) => { event.currentTarget.src = "/placeholder-cover.svg"; }} alt="" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
      <span className="absolute bottom-2 left-2 flex items-center gap-1 bg-slate-950/80 px-2 py-1 text-xs text-slate-200"><Clock3 size={12} /> {durationLabel(book.duration)}</span>
    </div>
  );
}

/** Decorative fill. The numbers beside it are the accessible representation. */
function ProgressBar({ percent }: { percent: number }) {
  return (
    <div aria-hidden="true" className="h-1 w-full overflow-hidden rounded-full bg-slate-700/70">
      <div className="h-full bg-cyan-400" style={{ width: `${percent}%` }} />
    </div>
  );
}

/**
 * Part-finished books, most recently played first. Rendered above the full
 * library by `App` so the "Continue listening" heading is not buried under the
 * "All audiobooks" one.
 */
export function ContinueListening({ books, onSelect }: { books: Audiobook[]; onSelect: (book: Audiobook) => void }) {
  if (!books.length) return null;
  return (
    <section className="mb-10" aria-labelledby="continue-listening">
      <div className="mb-4">
        <h2 id="continue-listening" className="text-2xl font-bold">Continue listening</h2>
        <p className="mt-1 text-sm text-slate-500">{books.length} {books.length === 1 ? "book is" : "books are"} part-finished</p>
      </div>
      <div className={cardGrid}>
        {books.map((book) => {
          const { line, percent } = describeBookProgress(book);
          return (
            <button key={book.id} onClick={() => onSelect(book)} className="group overflow-hidden rounded-lg border border-slate-800 bg-slate-900 text-left transition hover:-translate-y-1 hover:border-cyan-500/60 hover:bg-slate-800">
              <Cover book={book} />
              <div className="p-3">
                <h3 className="truncate font-semibold text-slate-100">{book.title}</h3>
                <p className="mt-1 truncate text-sm text-slate-400">{book.author}</p>
                <div className="mt-2" data-testid="card-progress">
                  <ProgressBar percent={percent} />
                  <p className="mt-1 truncate text-xs text-slate-400">{line}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/**
 * One card. The favourite heart and "find more like this" sit *outside* the
 * card's own button element rather than inside it -- nested buttons are
 * invalid HTML and break keyboard navigation.
 */
function LibraryCard({
  book,
  onSelect,
  showProgress,
  favourited,
  onToggleFavourite,
  onFindSimilar,
}: {
  book: Audiobook;
  onSelect: (book: Audiobook) => void;
  showProgress: boolean;
  favourited: boolean;
  onToggleFavourite?: (bookId: number) => void;
  onFindSimilar?: (book: Audiobook) => void;
}) {
  const { line, percent } = showProgress ? describeBookProgress(book) : { line: "", percent: 0 };
  const narrators = (book.contributors ?? []).filter((entry) => entry.role === "narrator");

  return (
    <div className="group relative">
      <button onClick={() => onSelect(book)} className="w-full overflow-hidden rounded-lg border border-slate-800 bg-slate-900 text-left transition hover:-translate-y-1 hover:border-cyan-500/60 hover:bg-slate-800">
        <Cover book={book} />
        <div className="p-3">
          <h3 className="truncate font-semibold text-slate-100">{book.title}</h3>
          <p className="mt-1 truncate text-sm text-slate-400">{book.author}</p>
          {narrators.length > 0 && (
            <p className="mt-1 truncate text-xs text-slate-500">
              Narrated by {narrators.length === 1 ? narrators[0].name : `${narrators.length} narrators`}
            </p>
          )}
          {book.tracks.length > 1 && <p className="mt-2 flex items-center gap-1 text-xs uppercase tracking-wider text-cyan-400"><Headphones size={12} /> {book.tracks.length} tracks</p>}
          {showProgress && (
            <div className="mt-2" data-testid="card-progress">
              <ProgressBar percent={percent} />
              <p className="mt-1 truncate text-xs text-slate-400">{line}</p>
            </div>
          )}
        </div>
      </button>

      {onToggleFavourite && (
        <div className="absolute right-1.5 top-1.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
          <FavouriteButton favourited={favourited} onToggle={() => onToggleFavourite(book.id)} label={book.title} />
        </div>
      )}
      {onFindSimilar && (
        <button
          type="button"
          onClick={() => onFindSimilar(book)}
          title="Find more like this"
          aria-label={`Find more like ${book.title}`}
          className="absolute bottom-1.5 right-1.5 grid size-9 place-items-center rounded-full border border-slate-700 bg-slate-950/85 text-slate-400 opacity-0 backdrop-blur transition hover:border-cyan-400 hover:text-cyan-300 focus:opacity-100 group-hover:opacity-100"
        >
          <Compass size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export function AudiobookGrid({
  books,
  onSelect,
  favourites,
  onToggleFavourite,
  onFindSimilar,
}: {
  books: Audiobook[];
  onSelect: (book: Audiobook) => void;
  favourites?: Set<number>;
  onToggleFavourite?: (bookId: number) => void;
  onFindSimilar?: (book: Audiobook) => void;
}) {
  if (!books.length) {
    return <div className="border border-dashed border-slate-700 bg-slate-900/60 px-6 py-16 text-center text-slate-400">Your library is empty. Add a folder and run a scan to discover audiobooks.</div>;
  }

  const continuingIds = new Set(inProgressBooks(books).map((book) => book.id));

  return (
    <div className={cardGrid}>
      {books.map((book) => (
        <LibraryCard
          key={book.id}
          book={book}
          onSelect={onSelect}
          showProgress={continuingIds.has(book.id)}
          favourited={favourites?.has(book.id) ?? false}
          onToggleFavourite={onToggleFavourite}
          onFindSimilar={onFindSimilar}
        />
      ))}
    </div>
  );
}
