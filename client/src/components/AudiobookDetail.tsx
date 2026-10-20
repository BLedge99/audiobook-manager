import { X, Clock3, Compass, FileAudio, ChevronDown, Heart, Sparkles } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { Audiobook, GenreNode, TagSummary } from "../types";
import { bookCoverKey, CoverImage } from "../local/CoverImage";
import { useTagSuite } from "../useBrowse";
import { ChapterPlayer } from "./ChapterPlayer";
import { TagSuiteEditor } from "./TagSuiteEditor";
import { copy } from "../copy";
import { Btn, cn, durationLabel } from "../ui/primitives";

interface Candidate {
  id: number;
  source: string;
  title: string;
  author?: string;
  coverUrl?: string;
  description?: string;
  confidence?: number;
}

function MetadataEditor({ book, onUpdated }: { book: Audiobook; onUpdated: () => void }) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  const enrich = async () => {
    setState("loading");
    try {
      const res = await fetch(`/api/audiobooks/${book.id}/enrich`, { method: "POST" });
      if (!res.ok) throw new Error();
      const list = await res.json();
      const rows: Candidate[] = list.map((candidate: { source: string; title: string; author?: string; coverUrl?: string; description?: string; confidence?: number }, index: number) => ({ id: index, ...candidate }));
      // Re-fetch stored candidates so we have real ids
      const stored = await fetch(`/api/audiobooks/${book.id}/candidates`);
      setCandidates(stored.ok ? await stored.json() : rows);
      setState("ready");
    } catch {
      setState("error");
    }
  };

  const apply = async (candidateId: number) => {
    const res = await fetch(`/api/audiobooks/${book.id}/metadata`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId }),
    });
    if (res.ok) onUpdated();
  };

  return (
    <div className="mt-6 border-t-2 border-dashed border-ink/20 pt-4">
      <Btn size="sm" onClick={() => void enrich()} disabled={state === "loading"}>
        <Sparkles size={15} aria-hidden="true" /> {state === "loading" ? copy.detail.metadataLookingUp : copy.detail.metadataLookup}
      </Btn>
      {state === "error" && (
        <p role="alert" className="mt-2 text-[13px] font-bold text-rasp-ink">{copy.detail.metadataFailed}</p>
      )}
      {state === "ready" && (
        <ul className="mt-3 grid gap-2">
          {candidates.length === 0 && <li className="text-[13.5px] text-ink3">{copy.detail.noMatches}</li>}
          {candidates.map((candidate) => (
            <li
              key={candidate.id}
              className="flex items-center justify-between gap-3 rounded-[14px_11px_14px_11px/11px_14px_11px_14px] border-2 border-ink/20 bg-sunk px-3 py-2 text-[13.5px]"
            >
              <span className="min-w-0 truncate text-ink2">
                {candidate.title} {candidate.author && <span className="text-ink3">— {candidate.author}</span>}
                <span className="ml-2 text-[11px] font-bold uppercase text-ink3">{candidate.source}</span>
              </span>
              <Btn size="sm" variant="quiet" onClick={() => void apply(candidate.id)} className="shrink-0">{copy.use}</Btn>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Everything behind the "Book details" fold (spec 15b feature 5).
 *
 * Its own component for one reason that matters: it is mounted only when the
 * fold is open, so `useTagSuite` -- which fetches on mount -- does not run every
 * time someone opens a book. Called from `AudiobookDetail` instead, the hook
 * would fire on every open no matter what the disclosure said, and the comment
 * claiming otherwise would have been a lie that only the network could correct.
 *
 * It holds only what the fold's own "Details" panel does not already show.
 * Series and the description used to be printed twice on this screen -- once as
 * prose and once inside `TagSuiteEditor`, which renders every field as readable
 * text when it is not being edited. That predates this spec; moving the panel
 * behind a disclosure was the moment to stop printing it twice, and adding a
 * prose copy back here would have re-created it.
 */
function BookDetails({
  book,
  genres,
  tags,
  onBookUpdated,
}: {
  book: Audiobook;
  genres: GenreNode[];
  tags: TagSummary[];
  onBookUpdated?: () => void;
}) {
  const suite = useTagSuite(book.id);

  return (
    <>
      {/* Spec 20: the full, individually editable tag suite with provenance,
          including series, description, genres, tags and narrators. */}
      <TagSuiteEditor book={book} genres={genres ?? []} tags={tags ?? []} suite={suite} onSaved={() => onBookUpdated?.()} />

      <MetadataEditor book={book} onUpdated={() => onBookUpdated?.()} />
    </>
  );
}

export function AudiobookDetail({
  book,
  onClose,
  onProgressSaved,
  genres,
  tags,
  favourited,
  onToggleFavourite,
  onFindSimilar,
  onBookUpdated,
  deviceAction,
  localUrlForTrack,
}: {
  book: Audiobook;
  onClose: () => void;
  onProgressSaved?: () => void;
  genres?: GenreNode[];
  tags?: TagSummary[];
  favourited?: boolean;
  onToggleFavourite?: (bookId: number) => void;
  onFindSimilar?: (bookId: number) => void;
  onBookUpdated?: () => void;
  /**
   * Download / remove control for the device copy (spec 26, Sprint 2).
   *
   * Optional rather than required so the PWA and the browser dev app render
   * exactly as before: there is no device library there to manage, and a
   * Download button that cannot work is worse than no button.
   */
  deviceAction?: ReactNode;
  /**
   * Resolve a downloaded track to a playable local URL, so playback works with
   * the network off (spec 26). Optional for the same reason as `deviceAction`.
   */
  localUrlForTrack?: (bookId: number, trackId: number) => Promise<string | undefined>;
}) {
  const narrators = (book.contributors ?? []).filter((entry) => entry.role === "narrator");
  /**
   * Spec 15b feature 5 — the metadata lives behind a disclosure, and is not
   * rendered at all until it is opened.
   *
   * A native `<details>` would have kept its children in the DOM, which means
   * the tag suite would still mount and still fetch on every book open. See
   * `BookDetails` for why that hook moved.
   */
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    /* `fixed inset-0` with the <article> as its direct child is load-bearing:
       `e2e/phone-layout` locates the dialog with
       `page.locator("div.fixed.inset-0 > article")` and then asserts the article
       does not scroll sideways inside itself. Do not wrap or restructure. */
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-sunk/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <article
        className="panel relative grid max-h-[92dvh] w-full max-w-3xl grid-cols-[minmax(0,1fr)] overflow-auto rounded-b-none sm:rounded-[26px_20px_26px_20px/20px_26px_20px_26px] md:grid-cols-[220px_minmax(0,1fr)]"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          aria-label={copy.detail.close}
          onClick={onClose}
          className="iconbtn absolute right-3 top-3 z-10 bg-surface/90 backdrop-blur-sm"
        >
          <X size={19} aria-hidden="true" />
        </button>

        {/* `minmax(0,1fr)` on both breakpoints is the actual fix, and is the standard
            remedy for a grid blowout. A bare `grid` / `1fr` track has an `auto`
            *maximum*, which resolves to the content's max-content width -- for
            the description that is the whole paragraph on one line. The column
            was 615px inside a 359px dialog; the dialog's own `overflow-auto`
            turned that into sideways scrolling that read as "zoomed in".

            `min-w-0` on the children is necessary but not sufficient on its own:
            it lowers the item minimum, not the track maximum.

            Note `e2e/phone-layout` initially gave a false green here, because it
            only asserted the *document* did not scroll -- the dialog is viewport
            width, so the page was fine while the dialog scrolled inside itself.
            It now asserts the dialog does not scroll internally too. */}
        <div className="relative min-w-0">
          {/*
            Smaller on a phone than the `md` 180px cap. The detail dialog stacks
            on one column below `md`, so on the device this app mostly runs on,
            a 270px-tall cover pushed the player -- the thing someone opened the
            book for -- below the fold. 120px keeps the artwork recognisable and
            brings the transport up with the title.

            The bytes come from the device cache like every other cover, so a
            book opened on a train shows its cover.
          */}
          <CoverImage
            cacheKey={bookCoverKey(book.id)}
            className="mx-auto block aspect-[2/3] w-full max-w-[120px] min-w-0 [&>img]:h-full [&>img]:w-full [&>img]:object-cover sm:max-w-[180px] md:h-full md:max-w-none"
          />
          <span className="capsule__seam" aria-hidden="true" />
        </div>

        {/*
          Spec 15b feature 5 — player first.

          The order here is the argument: cover, what this is, **play it**, then
          the things a listener does next, then the one-line facts, then a fold
          for everything the operator cares about. It previously ran
          tags → description → online metadata lookup → player, so the most
          common reason for opening a book was the last thing on the page. That
          is ADR 012's own thesis -- the device is a synchronised player, not a
          second library manager -- contradicted by its own layout.

          Nothing here was rebuilt. `ChapterPlayer`, `position.ts` and
          `ProgressTimeline` are spec 14/15's work and are untouched.
        */}
        <div className="min-w-0 p-5 pt-14 md:p-8 md:pt-8">
          <h2 className="pr-10 text-[26px] leading-[1.08] md:text-3xl">{book.title}</h2>
          {book.subtitle && <p className="mt-1 text-[16px] italic text-ink2 md:text-lg">{book.subtitle}</p>}
          <p className="mt-2 text-[16px] font-semibold text-ink2 md:text-lg">{book.author}</p>
          {narrators.length > 0 && (
            <p className="mt-1 text-[13.5px] text-ink3">{copy.narratedBy(narrators.map((entry) => entry.name).join(", "))}</p>
          )}
          {deviceAction && <div className="mt-5">{deviceAction}</div>}

          <ChapterPlayer key={book.id} book={book} onProgressSaved={onProgressSaved} localUrlForTrack={localUrlForTrack} />

          {/* Spec 18/19/20: favourite and find-more-like actions on the book.
              Above the fold, because both are things a listener does next. */}
          {(onToggleFavourite || onFindSimilar) && (
            <div className="mt-4 flex flex-wrap gap-2">
              {onToggleFavourite && (
                <Btn
                  onClick={() => onToggleFavourite(book.id)}
                  aria-pressed={favourited}
                  variant={favourited ? "primary" : "plain"}
                >
                  <Heart size={15} fill={favourited ? "currentColor" : "none"} aria-hidden="true" />
                  {favourited ? copy.favourite.inYours : copy.favourite.add}
                </Btn>
              )}
              {onFindSimilar && (
                <Btn onClick={() => onFindSimilar(book.id)} variant="quiet">
                  <Compass size={15} aria-hidden="true" /> {copy.findMoreLikeThis}
                </Btn>
              )}
            </div>
          )}

          {/* The facts that fit on one line stay out of the fold. A reader
              choosing between two books needs "how long is it", not a
              paragraph. */}
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] font-semibold text-ink2">
            <span className="flex items-center gap-1.5"><Clock3 size={15} aria-hidden="true" /> {durationLabel(book.duration)}</span>
            <span className="flex items-center gap-1.5"><FileAudio size={15} aria-hidden="true" /> {book.fileFormat.toUpperCase()}</span>
            {book.publishedYear && <span className="tnum">{book.publishedYear}</span>}
            {book.publisher && <span className="truncate">{book.publisher}</span>}
          </div>

          <div className="mt-5">
            <Btn
              variant="quiet"
              size="sm"
              onClick={() => setDetailsOpen((open) => !open)}
              aria-expanded={detailsOpen}
              aria-controls="book-details"
            >
              <ChevronDown
                size={16}
                aria-hidden="true"
                className={cn("transition-transform", detailsOpen && "rotate-180")}
              />
              {copy.detail.bookDetails}
            </Btn>

            {detailsOpen && (
              <div id="book-details" className="mt-4 grid gap-5">
                <BookDetails book={book} genres={genres ?? []} tags={tags ?? []} onBookUpdated={onBookUpdated} />
              </div>
            )}
          </div>
        </div>
      </article>
    </div>
  );
}