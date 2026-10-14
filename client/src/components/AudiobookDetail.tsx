import { X, Clock3, Compass, FileAudio, Heart, Sparkles } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { Audiobook, GenreNode, TagSummary } from "../types";
import { coverUrl } from "../lib/api";
import { useTagSuite } from "../useBrowse";
import { ChapterPlayer } from "./ChapterPlayer";
import { TagSuiteEditor } from "./TagSuiteEditor";

function durationLabel(seconds: number) {
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

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
    <div className="mt-6 border-t border-slate-800 pt-4">
      <button type="button" onClick={() => void enrich()} className="flex items-center gap-2 text-sm text-cyan-400 hover:text-cyan-300">
        <Sparkles size={16} /> {state === "loading" ? "Looking up…" : "Find metadata online"}
      </button>
      {state === "error" && <p className="mt-2 text-sm text-rose-300">Metadata lookup failed. Try again later.</p>}
      {state === "ready" && (
        <ul className="mt-3 space-y-2">
          {candidates.length === 0 && <li className="text-sm text-slate-500">No matches found.</li>}
          {candidates.map((candidate) => (
            <li key={candidate.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-slate-300">
                {candidate.title} {candidate.author && <span className="text-slate-500">— {candidate.author}</span>}
                <span className="ml-2 text-xs uppercase text-slate-600">{candidate.source}</span>
              </span>
              <button type="button" onClick={() => void apply(candidate.id)} className="shrink-0 border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:border-cyan-400">Use</button>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" onClick={onClose}>
      <article className="relative grid max-h-[90vh] w-full max-w-3xl grid-cols-[minmax(0,1fr)] overflow-auto rounded-xl border border-slate-700 bg-slate-900 shadow-2xl md:grid-cols-[220px_minmax(0,1fr)]" onClick={(event) => event.stopPropagation()}>
        <button aria-label="Close details" onClick={onClose} className="absolute right-3 top-3 rounded-full bg-slate-950/80 p-2 text-slate-300 hover:text-white"><X size={20} /></button>
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
        <img src={coverUrl(book.id)} onError={(event) => { event.currentTarget.src = "/placeholder-cover.svg"; }} alt="" className="mx-auto aspect-[2/3] w-full max-w-[180px] min-w-0 object-cover md:max-w-none md:h-full" />
        <div className="min-w-0 p-5 md:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-400">Audiobook</p>
          <h2 className="mt-3 pr-10 text-2xl font-bold text-white md:text-3xl">{book.title}</h2>
          {book.subtitle && <p className="mt-1 text-base italic text-slate-400 md:text-lg">{book.subtitle}</p>}
          <p className="mt-2 text-base text-slate-300 md:text-lg">{book.author}</p>
          {narrators.length > 0 && (
            <p className="mt-1 text-sm text-slate-400">Narrated by {narrators.map((entry) => entry.name).join(", ")}</p>
          )}
          {deviceAction && <div className="mt-5">{deviceAction}</div>}
          {book.series && (
            <p className="mt-1 text-sm text-slate-400">
              {book.series.name}{book.seriesPosition != null && ` · Book ${book.seriesPosition}`}
            </p>
          )}

          {/* Spec 18/19/20: favourite and find-more-like actions on the book. */}
          {(onToggleFavourite || onFindSimilar) && (
            <div className="mt-4 flex flex-wrap gap-2">
              {onToggleFavourite && (
                <button
                  type="button"
                  onClick={() => onToggleFavourite(book.id)}
                  aria-pressed={favourited}
                  className="flex items-center gap-2 rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-rose-400 hover:text-rose-300"
                >
                  <Heart size={15} fill={favourited ? "currentColor" : "none"} aria-hidden="true" />
                  {favourited ? "In your favourites" : "Add to favourites"}
                </button>
              )}
              {onFindSimilar && (
                <button
                  type="button"
                  onClick={() => onFindSimilar(book.id)}
                  className="flex items-center gap-2 rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-cyan-400 hover:text-cyan-300"
                >
                  <Compass size={15} aria-hidden="true" /> Find more like this
                </button>
              )}
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-3 text-sm text-slate-300">
            <span className="flex items-center gap-2"><Clock3 size={16} /> {durationLabel(book.duration)}</span>
            <span className="flex items-center gap-2"><FileAudio size={16} /> {book.fileFormat.toUpperCase()}</span>
            {book.publishedYear && <span>{book.publishedYear}</span>}
            {book.publisher && <span className="truncate">{book.publisher}</span>}
          </div>
          {book.description && <p className="mt-6 leading-7 text-slate-400">{book.description}</p>}

          {/* Spec 20: the full, individually editable tag suite with provenance. */}
          <TagSuiteEditor book={book} genres={genres ?? []} tags={tags ?? []} suite={suite} onSaved={() => onBookUpdated?.()} />

          <MetadataEditor book={book} onUpdated={() => onBookUpdated?.()} />
          <ChapterPlayer key={book.id} book={book} onProgressSaved={onProgressSaved} localUrlForTrack={localUrlForTrack} />
        </div>
      </article>
    </div>
  );
}
