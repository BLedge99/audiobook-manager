import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import type { Audiobook } from "../types";
import { copy } from "../copy";
import { responseErrorText } from "../lib/apiError";
import { Btn, MachineHead, Swatch, cn } from "../ui/primitives";
import { CoverImage, urlCoverKey } from "../local/CoverImage";

/**
 * Spec 20 -- the enrichment review queue.
 *
 * Spec 16 only auto-applies a match at or above the confidence threshold.
 * Everything below it waits here rather than silently overwriting a good
 * embedded title, so this is where the operator resolves the ambiguous cases.
 *
 * Nothing here is dismissible. The rows stay until a decision is made, because
 * the whole failure this queue prevents is a metadata error that silently
 * survives because nobody noticed it in passing.
 */

interface Candidate {
  id: number;
  source: string;
  title: string;
  author?: string | null;
  narrators?: string | null;
  coverUrl?: string | null;
  confidence?: number | null;
  genres?: string | null;
  seriesName?: string | null;
  publisher?: string | null;
  publishedYear?: number | null;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const profileId = window.localStorage.getItem("profileId");
  const headers: Record<string, string> = {};
  if (options?.body) headers["Content-Type"] = "application/json";
  if (profileId) headers["x-profile-id"] = profileId;
  const response = await fetch(url, { ...options, headers: { ...headers, ...(options?.headers as Record<string, string>) } });
  if (!response.ok) {
    throw new Error(await responseErrorText(response));
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

function decodeList(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Confidence is a number the operator judges, so it gets a number, a word and
 * a colour -- never a colour alone.
 */
function confidenceVerdict(confidence: number) {
  if (confidence >= 75) return { label: copy.operator.review.strongMatch, color: "var(--mint)" };
  if (confidence >= 50) return { label: copy.operator.review.possibleMatch, color: "var(--tan)" };
  return { label: copy.operator.review.weakMatch, color: "var(--ink-3)" };
}

function CandidateRow({
  candidate,
  onApply,
  onSkip,
}: {
  candidate: Candidate;
  onApply: () => void;
  onSkip: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const confidence = Math.round((candidate.confidence ?? 0) * 100);
  const narrators = decodeList(candidate.narrators);
  const genres = decodeList(candidate.genres);
  const verdict = confidenceVerdict(confidence);

  const act = async (action: () => Promise<unknown>, done?: () => void) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      done?.();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : copy.operator.review.actionFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 flex gap-3 rounded-[18px_14px_18px_14px/14px_18px_14px_18px] border-2 border-ink/25 bg-sunk p-3">
      {/*
        The same cached cover as every other surface. It previously used a
        third fallback convention -- `style.display = "none"` on error -- which
        is why a cover could vanish with nothing in its place. One resolver, one
        fallback, one behaviour.
      */}
      {candidate.coverUrl && (
        <CoverImage
          cacheKey={urlCoverKey(candidate.coverUrl)}
          className="h-20 w-14 shrink-0 rounded-[8px_6px_8px_6px/6px_8px_6px_8px] border border-ink/25 [&>img]:h-full [&>img]:w-full [&>img]:object-cover"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-ink/25 bg-surface px-2 py-0.5 text-[11px] font-bold text-ink2">
            {candidate.source}
          </span>
          <span title={copy.operator.review.matchConfidence} className="inline-flex items-center gap-1.5 text-[11px] font-bold">
            <Swatch color={verdict.color} />
            <span className="tnum">{copy.operator.review.matchPercent(confidence)}</span>
            <span className="text-ink3">· {verdict.label}</span>
          </span>
        </div>
        <p className="mt-1.5 truncate font-display text-[15px] font-semibold text-ink">{candidate.title}</p>
        <p className="truncate text-[12.5px] text-ink2">{candidate.author ?? copy.unknownAuthor}</p>
        {narrators.length > 0 && <p className="mt-0.5 truncate text-[11.5px] text-ink3">{copy.narratedBy(narrators.slice(0, 3).join(", "))}</p>}
        {genres.length > 0 && <p className="mt-0.5 truncate text-[11.5px] text-ink3">{genres.join(", ")}</p>}
        {candidate.seriesName && <p className="mt-0.5 text-[11.5px] text-ink3">{copy.operator.review.series(candidate.seriesName)}</p>}

        {error && <p role="alert" className="mt-1.5 text-[12px] font-bold text-rasp-ink">{error}</p>}

        {/* 44px targets: this is the screen an operator uses with one hand while
            holding a coffee, and "Use this" is the decision that matters. */}
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Btn
            size="sm"
            variant="primary"
            disabled={busy}
            onClick={() =>
              void act(
                () => request(`/api/audiobooks/${candidate.id}/metadata`, { method: "POST", body: JSON.stringify({ candidateId: candidate.id }) }),
                onApply,
              )
            }
          >
            <Check size={13} aria-hidden="true" /> {copy.use}
          </Btn>
          <Btn
            size="sm"
            variant="quiet"
            disabled={busy}
            onClick={() =>
              void act(
                () => request(`/api/audiobooks/${candidate.id}/metadata/reset`, { method: "POST" }),
                onSkip,
              )
            }
          >
            {copy.operator.review.keepWhatIHave}
          </Btn>
        </div>
      </div>
    </div>
  );
}

export function ReviewQueue({ books, onResolved }: { books: Audiobook[]; onResolved: () => void }) {
  if (books.length === 0) return null;

  return (
    <section
      className="panel mb-8 p-4 sm:p-5"
      aria-labelledby="review-queue"
      style={{ background: "color-mix(in srgb, var(--tan) 10%, var(--surface))" }}
    >
      <MachineHead id="review-queue" title={copy.operator.review.heading} />
      <p className="text-[13.5px] text-ink2">{copy.operator.review.intro(books.length)}</p>

      <div className="mt-4 space-y-3">
        {books.map((book) => (
          <ReviewRow key={book.id} book={book} onResolved={onResolved} />
        ))}
      </div>
    </section>
  );
}

function ReviewRow({ book, onResolved }: { book: Audiobook; onResolved: () => void }) {
  const [candidates, setCandidates] = useState<Candidate[]>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    void request<Candidate[]>(`/api/audiobooks/${book.id}/candidates`)
      .then(setCandidates)
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : copy.operator.review.loadFailed))
      .finally(() => setLoading(false));
  };

  // Fetched on mount rather than in bulk with the queue: a household may have
  // dozens queued, and most operators only look at one at a time.
  useEffect(() => {
    load();
  }, []);

  if (loading) return <p className={cn("py-2 text-sm text-ink2")}>{copy.operator.review.checking(book.title)}</p>;
  if (error) return <p role="alert" className="py-2 text-sm font-bold text-rasp-ink">{error}</p>;
  if (!candidates || candidates.length === 0) return null;

  return (
    <div className={cn("rounded-[18px_14px_18px_14px/14px_18px_14px_18px] border-2 border-ink/25 bg-surface p-3")}>
      <h3 className="font-display text-[15px] font-semibold text-ink">{book.title}</h3>
      <p className="mt-0.5 text-[12px] text-ink3">{copy.operator.review.currentlyShownAs(book.title, book.author)}</p>
      {candidates.map((candidate) => (
        <CandidateRow
          key={candidate.id}
          candidate={candidate}
          onApply={() => {
            setCandidates(undefined);
            onResolved();
          }}
          onSkip={onResolved}
        />
      ))}
    </div>
  );
}