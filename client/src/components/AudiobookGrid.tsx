import { memo, useMemo } from "react";
import { Compass, Headphones, Clock3 } from "lucide-react";
import type { ReactNode } from "react";
import type { Audiobook } from "../types";
import { FavouriteButton } from "./FavouriteButton";
import { isFromThisServer } from "../lib/api";
import {
  describePosition,
  hasProgress,
  parseSegments,
  timeLabel,
  totalDuration,
} from "../lib/position";
import { headingText, remainingLabel } from "../lib/segmentCopy";
import { copy } from "../copy";
import {
  CapsuleMarks,
  MachineHead,
  ShellCover,
  StatusTag,
  Tube,
  cn,
  durationLabel,
  statusFor,
} from "../ui/primitives";

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
    const heading = headingText(described.heading);
    parts.push(`${heading}${described.title ? ` · ${described.title}` : ""}`);
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

const cardGrid = "grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5";

/** The readout stamped into the shell: how long the book is, in tabular figures. */
function Stamp({ book }: { book: Audiobook }) {
  return (
    <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full border border-ink/25 bg-surface px-2 py-0.5 text-[11px] font-bold text-ink2 tnum">
      <Clock3 size={11} aria-hidden="true" />
      {durationLabel(book.duration)}
    </span>
  );
}

/**
 * One book, as a capsule.
 *
 * The favourite heart and "find more like this" sit *outside* the card's own
 * button element rather than inside it -- nested buttons are invalid HTML and
 * break keyboard navigation. Both are always in the tab order and revealed on
 * hover/focus, because a hover-only control is a control a touch user cannot
 * reach.
 */
const LibraryCard = memo(function LibraryCard({
  book,
  onSelect,
  showProgress,
  favourited,
  needsReview,
  alt,
  onToggleFavourite,
  onFindSimilar,
}: {
  book: Audiobook;
  onSelect: (book: Audiobook) => void;
  showProgress: boolean;
  favourited: boolean;
  needsReview: boolean;
  alt: boolean;
  onToggleFavourite?: (bookId: number) => void;
  onFindSimilar?: (book: Audiobook) => void;
}) {
  // Progress maths walks every chapter/track of the book; it runs only when
  // the card actually shows progress, and only when the book identity changes.
  const progress = useMemo(
    () => (showProgress ? describeBookProgress(book) : null),
    [book, showProgress],
  );
  const narrators = (book.contributors ?? []).filter((entry) => entry.role === "narrator");
  const line = progress?.line ?? "";
  const percent = progress?.percent ?? 0;
  const status = statusFor(percent);

  return (
    <article
      data-book-id={book.id}
      className={cn(
        "capsule group relative flex flex-col p-2",
        alt && "capsule--alt",
        // A book waiting on a metadata decision holds its mark until someone
        // looks at it, rather than quietly blending back into the grid.
        needsReview && "ring-2 ring-rasp",
      )}
    >
      <button onClick={() => onSelect(book)} className="relative block w-full text-left">
        {/* In flow, above the cover. As an absolutely positioned tab it was
            clipped by the neighbouring capsule in a tight 2-across grid, and a
            ring alone was too quiet to say "this changed" -- which is the whole
            point of the queue holding its mark. */}
        {needsReview && (
          <span className="mb-1.5 inline-flex rounded-full border-2 border-ink bg-rasp px-2 py-0.5 text-[10px] font-bold text-white">
            {copy.status.changed}
          </span>
        )}
        <span className="relative block">
          <ShellCover bookId={book.id} serverId={book.serverId} className="w-full" />
          <CapsuleMarks />
          <Stamp book={book} />
        </span>
        <span className="block pt-2.5">
          {/* `line-clamp-2` with a reserved two-line height rather than
              `truncate`: in a 2-across grid a truncated title hides the word
              that distinguishes "Short Ghost and Horror Collection 034" from
              052, and the varying height left every row of the shelf ragged.
              The author line is reserved to one line for the same reason. */}
          <h3 className="line-clamp-2 min-h-[2.3em] font-display text-[15px] font-semibold leading-tight text-ink">
            {book.title}
          </h3>
          <p className="mt-0.5 truncate text-[12.5px] text-ink2">{book.author}</p>
          {narrators.length > 0 && (
            <p className="mt-0.5 truncate text-[11.5px] text-ink3">
              {narrators.length === 1
                ? copy.narratedBy(narrators[0].name)
                : copy.narratedByCount(narrators.length)}
            </p>
          )}
          {book.tracks.length > 1 && (
            <p className="mt-1.5 flex items-center gap-1 text-[11px] font-bold text-cobalt">
              <Headphones size={12} aria-hidden="true" /> {copy.card.tracks(book.tracks.length)}
            </p>
          )}
        </span>
        {showProgress && (
          <span className="mt-2 block" data-testid="card-progress">
            <Tube percent={percent} />
            <span className="mt-1.5 flex items-center justify-between gap-2">
              <StatusTag status={status} />
              <span className="truncate text-[11px] text-ink3 tnum">{line}</span>
            </span>
          </span>
        )}
      </button>

      {/*
        Both card actions live in one cluster at the top-right. "Find more like
        this" used to sit at the bottom-right, where it sat on top of the
        progress tube and the status row on every part-finished book -- the one
        card that has the most to say.
        Hover reveals them on a pointer device; on touch they are always visible,
        because a hover-only control is one a thumb can never reach.
      */}
      {/* Favourites are per-server; a book this server does not hold could
          share its id with one it does, and favouriting would hit the wrong
          catalogue entry. The heart only appears for books from the
          connected server. */}
      {(onToggleFavourite || onFindSimilar) && (
        <div className="absolute right-2 top-2 flex items-center gap-1.5 transition-opacity focus-within:opacity-100 max-sm:opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
          {onToggleFavourite && isFromThisServer(book) && (
            <FavouriteButton favourited={favourited} onToggle={() => onToggleFavourite(book.id)} label={book.title} />
          )}
          {onFindSimilar && (
            <button
              type="button"
              onClick={() => onFindSimilar(book)}
              title={copy.findMoreLikeThis}
              aria-label={copy.card.findMoreLike(book.title)}
              className="iconbtn bg-surface/90"
            >
              <Compass size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </article>
  );
});

/**
 * The dock: where a part-finished book waits.
 *
 * The first book is featured -- it is the one the listener is most likely to
 * want, so it gets the play dome and the most room. The rest ride in a
 * scroll-snapped rail, because a household library has more than one thing
 * half-heard and a phone has one column.
 */
export function ContinueListening({ books, onSelect }: { books: Audiobook[]; onSelect: (book: Audiobook) => void }) {
  if (!books.length) return null;
  // `books[0]` is the featured dock book and `rest` is only counted for the
  // screen-reader hint below, so neither is destructured out of the array.
  const rest = books.slice(1);

  return (
    <section aria-labelledby="continue-listening" className="mb-9">
      <MachineHead
        id="continue-listening"
        title={copy.continueListening.heading}
        count={copy.continueListening.count(books.length)}
      />
      {/* Bleeds to the screen edge on a phone so a shelf reads as continuing
          rather than as a boxed list that happens to be cut off; the clipping
          room lives in `.scroll-bleed`. */}
      <div className="scroll-bleed snap-x snap-mandatory">
        {books.map((book, index) => {
          const { line, percent } = describeBookProgress(book);
          const isFeatured = index === 0;
          return (
            <button
              key={`${book.serverId ?? ""}#${book.id}`}
              onClick={() => onSelect(book)}
              className={cn(
                "capsule flex shrink-0 snap-start items-center gap-3 p-3 text-left",
                index % 2 ? "capsule--alt" : "",
                isFeatured ? "w-[330px] max-w-[86vw]" : "w-[260px] max-w-[74vw]",
              )}
            >
              <ShellCover bookId={book.id} serverId={book.serverId} className={isFeatured ? "w-[68px] shrink-0" : "w-[54px] shrink-0"} />
              <span className="min-w-0 flex-1">
                <h3 className={cn("truncate font-display font-semibold text-ink", isFeatured ? "text-[17px]" : "text-[15px]")}>
                  {book.title}
                </h3>
                <span className="mt-0.5 block truncate text-[12.5px] text-ink2">{book.author}</span>
                <span className="mt-2 block">
                  <Tube percent={percent} />
                </span>
                {/* Two rows rather than one: "In progress" and a chapter
                    reference side by side in a 330px capsule left neither
                    enough width to stay on one line. */}
                <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <StatusTag status={statusFor(percent)} />
                  <span className="truncate text-[11px] text-ink3 tnum">{line}</span>
                </span>
              </span>
              {isFeatured ? (
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full border-2 border-ink bg-rasp shadow-[0_4px_0_color-mix(in_srgb,var(--ink)_88%,transparent)]">
                  <span className="dome__play" aria-hidden="true" />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <span className="sr-only">{copy.continueListening.more(rest.length)}</span>
    </section>
  );
}

export function AudiobookGrid({
  books,
  onSelect,
  favourites,
  onToggleFavourite,
  onFindSimilar,
  changedIds,
  emptyMessage,
  emptyAction,
}: {
  books: Audiobook[];
  onSelect: (book: Audiobook) => void;
  favourites?: Set<number>;
  onToggleFavourite?: (bookId: number) => void;
  onFindSimilar?: (book: Audiobook) => void;
  changedIds?: Set<number>;
  /**
   * What to say when there is nothing to show.
   *
   * The default is about an empty *library*, which is right on the Library tab
   * and wrong everywhere else -- an empty Favourites tab is not an empty
   * library. `Shelves` has the same prop, for the same reason.
   */
  emptyMessage?: string;
  /** The next useful action, offered alongside the message. */
  emptyAction?: ReactNode;
}) {
  if (!books.length) {
    return (
      <div className="panel panel--sunk px-6 py-16 text-center text-ink2">
        <p>{emptyMessage ?? copy.library.empty}</p>
        {emptyAction ? <div className="mt-4 flex justify-center">{emptyAction}</div> : null}
      </div>
    );
  }

  const continuingBooks = useMemo(() => inProgressBooks(books), [books]);
  const continuingIds = useMemo(() => new Set(continuingBooks.map((book) => book.id)), [continuingBooks]);
  const reviewIds = useMemo(() => new Set(changedIds ?? []), [changedIds]);

  return (
    <div className={cardGrid}>
      {books.map((book, index) => {
        const showProgress = continuingIds.has(book.id);
        return (
          <LibraryCard
            key={`${book.serverId ?? ""}#${book.id}`}
            book={book}
            onSelect={onSelect}
            showProgress={showProgress}
            alt={index % 2 === 1}
            needsReview={reviewIds.has(book.id)}
            favourited={favourites?.has(book.id) ?? false}
            onToggleFavourite={onToggleFavourite}
            onFindSimilar={onFindSimilar}
          />
        );
      })}
    </div>
  );
}
