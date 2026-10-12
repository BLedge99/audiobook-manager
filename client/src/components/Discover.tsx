import { useEffect, useState } from "react";
import { Compass, Plus, RefreshCw, Trash2, Check } from "lucide-react";
import type { DiscoverResult, Recommendation, WishlistItem } from "../types";
import type { useDiscover } from "../useBrowse";

/**
 * Spec 20 — the Discover tab.
 *
 * Shows only books the household does NOT own (spec 19), and states plainly
 * when it cannot: offline, not enough metadata yet, or nothing found.
 * Recommendation here is tag-similarity, and the copy says so rather than
 * implying a recommender (ADR 010).
 */

function RecommendationCard({
  recommendation,
  saved,
  onSave,
}: {
  recommendation: Recommendation;
  saved: boolean;
  onSave: () => void;
}) {
  return (
    <article className="flex gap-4 overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
      <div className="relative w-24 shrink-0 bg-slate-800">
        <img
          src={recommendation.coverUrl ?? "/placeholder-cover.svg"}
          onError={(event) => { event.currentTarget.src = "/placeholder-cover.svg"; }}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
        />
      </div>
      <div className="min-w-0 flex-1 p-3">
        <h3 className="truncate font-semibold text-slate-100">{recommendation.title}</h3>
        <p className="truncate text-sm text-slate-400">{recommendation.author ?? "Unknown author"}</p>
        {recommendation.narrators.length > 0 && (
          <p className="mt-1 truncate text-xs text-slate-500">Narrated by {recommendation.narrators.slice(0, 3).join(", ")}</p>
        )}
        {recommendation.description && (
          <p className="mt-2 line-clamp-2 text-xs text-slate-400">{recommendation.description}</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-300">{recommendation.reason}</span>
          <button
            type="button"
            onClick={onSave}
            disabled={saved}
            className="flex items-center gap-1 rounded-full border border-cyan-400/60 px-3 py-1 text-xs text-cyan-300 hover:bg-cyan-400 hover:text-slate-950 disabled:opacity-60"
          >
            {saved ? <Check size={12} /> : <Plus size={12} />}
            {saved ? "On your wishlist" : "Save to wishlist"}
          </button>
        </div>
      </div>
    </article>
  );
}

function WishlistRow({ item, onRemove, onMarkOwned }: { item: WishlistItem; onRemove: () => void; onMarkOwned: (owned: boolean) => void }) {
  return (
    <article className="flex items-start gap-4 border border-slate-800 bg-slate-900/70 p-3">
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-medium text-slate-100">{item.title}</h3>
        <p className="truncate text-sm text-slate-400">{item.author ?? "Unknown author"}</p>
        {/* Wishlist books are metadata-only; there is deliberately no play control. */}
        <p className="mt-1 text-xs text-slate-500">Not in your library yet</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => onMarkOwned(!item.owned)}
          aria-pressed={item.owned}
          title={item.owned ? "Owned" : "Mark as owned"}
          className={`rounded p-2 ${item.owned ? "text-emerald-400" : "text-slate-500 hover:text-emerald-300"}`}
        >
          <Check size={16} />
        </button>
        <button type="button" onClick={onRemove} aria-label={`Remove ${item.title} from wishlist`} className="rounded p-2 text-slate-500 hover:text-red-400">
          <Trash2 size={16} />
        </button>
      </div>
    </article>
  );
}

/**
 * Maps a Discover status to an honest message. Returning noise dressed as
 * insight is worse than saying "not yet", so the empty states are explicit.
 */
function statusMessage(result: DiscoverResult): { tone: "info" | "warn"; text: string } | null {
  switch (result.status) {
    case "offline":
      return { tone: "warn", text: "You're offline. Discover needs a connection to suggest new titles — your library still works." };
    case "insufficient-metadata":
      return { tone: "info", text: result.message ?? "Not enough metadata yet." };
    case "no-results":
      return { tone: "info", text: result.message ?? "No new titles found yet." };
    default:
      return null;
  }
}

export function Discover({ discover, hasFavourites }: { discover: ReturnType<typeof useDiscover>; hasFavourites: boolean }) {
  const [saved, setSaved] = useState<Set<string>>(new Set());

  useEffect(() => {
    void discover.loadWishlist();
    // Discover is computed on demand (spec 19), so opening the tab is the
    // trigger -- not a background job.
    if (hasFavourites) void discover.loadForMe();
  }, [discover, hasFavourites]);

  const { result, wishlist, loading, error } = discover;
  const notice = result ? statusMessage(result) : null;

  return (
    <div className="space-y-10">
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-2xl font-bold">
              <Compass size={22} className="text-cyan-400" aria-hidden="true" /> Discover
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Titles you do not own yet, matched on genre, author, narrator and series.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void discover.loadForMe()}
            disabled={loading || !hasFavourites}
            className="flex items-center gap-2 rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-cyan-400 hover:text-white disabled:opacity-50"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} aria-hidden="true" /> Refresh
          </button>
        </div>

        {!hasFavourites && (
          <p className="border border-slate-800 bg-slate-900/60 px-4 py-6 text-sm text-slate-400">
            Favourite a few books and Discover will use them to suggest titles you do not own yet.
          </p>
        )}
        {error && <p className="border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</p>}
        {notice && (
          <p
            className={`px-4 py-3 text-sm ${
              notice.tone === "warn" ? "border border-amber-900/60 bg-amber-950/20 text-amber-200" : "border border-slate-800 bg-slate-900/60 text-slate-400"
            }`}
          >
            {notice.text}
          </p>
        )}

        {result?.recommendations.length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {result.recommendations.map((recommendation) => {
              const key = `${recommendation.provider}:${recommendation.providerKey ?? recommendation.title}`;
              return (
                <RecommendationCard
                  key={key}
                  recommendation={recommendation}
                  saved={saved.has(key)}
                  onSave={() => {
                    setSaved((current) => new Set(current).add(key));
                    void discover.save(recommendation).catch(() => setSaved((current) => {
                      const next = new Set(current);
                      next.delete(key);
                      return next;
                    }));
                  }}
                />
              );
            })}
          </div>
        ) : null}
      </section>

      <section aria-labelledby="wishlist">
        <h2 id="wishlist" className="mb-4 text-xl font-bold">Wishlist</h2>
        {wishlist.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing saved yet. Save a suggestion above to keep track of it.</p>
        ) : (
          <div className="grid gap-2">
            {wishlist.map((item) => (
              <WishlistRow
                key={item.id}
                item={item}
                onRemove={() => void discover.remove(item.id)}
                onMarkOwned={(owned) => void discover.markOwned(item.id, owned)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}