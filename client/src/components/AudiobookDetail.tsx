import { X, Clock3, Compass, FileAudio, Heart, Sparkles } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { Audiobook, GenreNode, TagSummary } from "../types";
import { coverUrl } from "../lib/api";
import { useTagSuite } from "../useBrowse";
import { ChapterPlayer } from "./ChapterPlayer";
import { TagSuiteEditor } from "./TagSuiteEditor";
import { Btn, durationLabel } from "../ui/primitives";

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
        <Sparkles size={15} aria-hidden="true" /> {state === "loading" ? "Looking up…" : "Find metadata online"}
      </Btn>
      {state === "error" && (
        <p role="alert" className="mt-2 text-[13px] font-bold text-rasp-ink">Metadata lookup failed. Try again later.</p>
      )}
      {state === "ready" && (
        <ul className="mt-3 grid gap-2">
          {candidates.length === 0 && <li className="text-[13.5px] text-ink3">No matches found.</li>}
          {candidates.map((candidate) => (
            <li
              key={candidate.id}
              className="flex items-center justify-between gap-3 rounded-[14px_11px_14px_11px/11px_14px_11px_14px] border-2 border-ink/20 bg-sunk px-3 py-2 text-[13.5px]"
            >
              <span className="min-w-0 truncate text-ink2">
                {candidate.title} {candidate.author && <span className="text-ink3">— {candidate.author}</span>}
                <span className="ml-2 text-[11px] font-bold uppercase text-ink3">{candidate.source}</span>
              </span>
              <Btn size="sm" variant="quiet" onClick={() => void apply(candidate.id)} className="shrink-0">Use</Btn>
            </li>
          ))}
        </ul>
      )}
    </div>
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
  const suite = useTagSuite(book.id);
  const narrators = (book.contributors ?? []).filter((entry) => entry.role === "narrator");

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
          aria-label="Close details"
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
          <img
            src={coverUrl(book.id)}
            onError={(event) => { event.currentTarget.src = "/placeholder-cover.svg"; }}
            alt=""
            className="mx-auto aspect-[2/3] w-full max-w-[180px] min-w-0 object-cover md:h-full md:max-w-none"
          />
          <span className="capsule__seam" aria-hidden="true" />
        </div>

        <div className="min-w-0 p-5 pt-14 md:p-8 md:pt-8">
          <h2 className="pr-10 text-[26px] leading-[1.08] md:text-3xl">{book.title}</h2>
          {book.subtitle && <p className="mt-1 text-[16px] italic text-ink2 md:text-lg">{book.subtitle}</p>}
          <p className="mt-2 text-[16px] font-semibold text-ink2 md:text-lg">{book.author}</p>
          {narrators.length > 0 && (
            <p className="mt-1 text-[13.5px] text-ink3">Narrated by {narrators.map((entry) => entry.name).join(", ")}</p>
          )}
          {deviceAction && <div className="mt-5">{deviceAction}</div>}
          {book.series && (
            <p className="mt-1 text-[13.5px] text-ink3">
              {book.series.name}{book.seriesPosition != null && ` · Book ${book.seriesPosition}`}
            </p>
          )}

          {/* Spec 18/19/20: favourite and find-more-like actions on the book. */}
          {(onToggleFavourite || onFindSimilar) && (
            <div className="mt-4 flex flex-wrap gap-2">
              {onToggleFavourite && (
                <Btn
                  onClick={() => onToggleFavourite(book.id)}
                  aria-pressed={favourited}
                  variant={favourited ? "primary" : "plain"}
                >
                  <Heart size={15} fill={favourited ? "currentColor" : "none"} aria-hidden="true" />
                  {favourited ? "In your favourites" : "Add to favourites"}
                </Btn>
              )}
              {onFindSimilar && (
                <Btn onClick={() => onFindSimilar(book.id)} variant="quiet">
                  <Compass size={15} aria-hidden="true" /> Find more like this
                </Btn>
              )}
            </div>
          )}

          <div className="mt-5 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] font-semibold text-ink2">
            <span className="flex items-center gap-1.5"><Clock3 size={15} aria-hidden="true" /> {durationLabel(book.duration)}</span>
            <span className="flex items-center gap-1.5"><FileAudio size={15} aria-hidden="true" /> {book.fileFormat.toUpperCase()}</span>
            {book.publishedYear && <span className="tnum">{book.publishedYear}</span>}
            {book.publisher && <span className="truncate">{book.publisher}</span>}
          </div>
          {book.description && <p className="mt-5 leading-relaxed text-ink2">{book.description}</p>}

          {/* Spec 20: the full, individually editable tag suite with provenance. */}
          <TagSuiteEditor book={book} genres={genres ?? []} tags={tags ?? []} suite={suite} onSaved={() => onBookUpdated?.()} />

          <MetadataEditor book={book} onUpdated={() => onBookUpdated?.()} />
          <ChapterPlayer key={book.id} book={book} onProgressSaved={onProgressSaved} localUrlForTrack={localUrlForTrack} />
        </div>
      </article>
    </div>
  );
}