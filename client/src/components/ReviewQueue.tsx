import { useEffect, useState } from "react";
import { AlertCircle, Check } from "lucide-react";
import type { Audiobook } from "../types";

/**
 * Spec 20 — the enrichment review queue.
 *
 * Spec 16 only auto-applies a match at or above the confidence threshold.
 * Everything below it waits here rather than silently overwriting a good
 * embedded title, so this is where the operator resolves the ambiguous cases.
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
    const body = await response.text();
    let message = body;
    try {
      message = JSON.parse(body).message || body;
    } catch {
      /* not json */
    }
    throw new Error(message || `Request failed (${response.status})`);
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

  const act = async (action: () => Promise<unknown>, done?: () => void) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      done?.();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex gap-3 border-b border-slate-800 py-3 last:border-b-0">
      {candidate.coverUrl && (
        <img
          src={candidate.coverUrl}
          alt=""
          onError={(event) => { event.currentTarget.style.display = "none"; }}
          className="h-20 w-14 shrink-0 rounded object-cover"
          loading="lazy"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs uppercase text-slate-400">{candidate.source}</span>
          {/* Confidence is always shown: the whole point of the queue is to
              let the operator judge how sure the match is. */}
          <span
            title="Match confidence"
            className={`rounded px-1.5 py-0.5 text-xs ${confidence >= 75 ? "bg-emerald-950 text-emerald-300" : confidence >= 50 ? "bg-amber-950 text-amber-300" : "bg-slate-800 text-slate-400"}`}
          >
            {confidence}% match
          </span>
        </div>
        <p className="mt-1 truncate text-sm font-medium text-slate-100">{candidate.title}</p>
        <p className="truncate text-xs text-slate-400">{candidate.author ?? "Unknown author"}</p>
        {narrators.length > 0 && <p className="mt-0.5 truncate text-xs text-slate-500">Narrated by {narrators.slice(0, 3).join(", ")}</p>}
        {genres.length > 0 && <p className="mt-0.5 truncate text-xs text-slate-500">{genres.join(", ")}</p>}
        {candidate.seriesName && <p className="mt-0.5 text-xs text-slate-500">Series: {candidate.seriesName}</p>}

        {error && <p className="mt-1 text-xs text-red-300">{error}</p>}

        <div className="mt-2 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void act(
                () => request(`/api/audiobooks/${candidate.id}/metadata`, { method: "POST", body: JSON.stringify({ candidateId: candidate.id }) }),
                onApply,
              )
            }
            className="flex items-center gap-1 rounded bg-cyan-400 px-3 py-1 text-xs font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-50"
          >
            <Check size={12} /> Use this
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void act(
                () => request(`/api/audiobooks/${candidate.id}/metadata/reset`, { method: "POST" }),
                onSkip,
              )
            }
            className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-400 hover:border-slate-500 disabled:opacity-50"
          >
            Keep what I have
          </button>
        </div>
      </div>
    </div>
  );
}

export function ReviewQueue({ books, onResolved }: { books: Audiobook[]; onResolved: () => void }) {
  if (books.length === 0) return null;

  return (
    <section className="mb-8 border border-amber-900/40 bg-amber-950/10 p-4" aria-labelledby="review-queue">
      <h2 id="review-queue" className="flex items-center gap-2 text-lg font-semibold">
        <AlertCircle size={18} className="text-amber-400" aria-hidden="true" /> Needs your review
      </h2>
      <p className="mb-3 mt-1 text-sm text-slate-400">
        {books.length} {books.length === 1 ? "book has" : "books have"} a possible match we were not confident enough to apply.
      </p>

      <div className="space-y-3">
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
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : "Failed"))
      .finally(() => setLoading(false));
  };

  // Fetched on mount rather than in bulk with the queue: a household may have
  // dozens queued, and most operators only look at one at a time.
  useEffect(() => {
    load();
  }, []);

  if (loading) return <p className="py-2 text-sm text-slate-500">Checking {book.title}…</p>;
  if (error) return <p className="py-2 text-sm text-red-300">{error}</p>;
  if (!candidates || candidates.length === 0) return null;

  return (
    <div className="border border-slate-800 bg-slate-900/70 p-3">
      <h3 className="mb-1 text-sm font-semibold text-slate-100">{book.title}</h3>
      <p className="mb-2 text-xs text-slate-500">currently shown as “{book.title}” by {book.author}</p>
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