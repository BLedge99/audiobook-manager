import { useEffect, useState } from "react";
import { Compass, Plus, RefreshCw, Trash2, Check, LoaderCircle } from "lucide-react";
import type { DiscoverResult, Recommendation, WishlistItem } from "../types";
import type { useDiscover } from "../useBrowse";
import { copy } from "../copy";
import { Btn, MachineHead, Notice, cn } from "../ui/primitives";
import { CoverImage, urlCoverKey } from "../local/CoverImage";

/**
 * Spec 20 -- the Discover tab.
 *
 * Shows only books the household does NOT own (spec 19), and states plainly
 * when it cannot: offline, not enough metadata yet, or nothing found.
 * Recommendation here is tag-similarity, and the copy says so rather than
 * implying a recommender (ADR 010).
 */

function RecommendationCard({
  recommendation,
  index,
  saved,
  onSave,
}: {
  recommendation: Recommendation;
  index: number;
  saved: boolean;
  onSave: () => void;
}) {
  return (
    <article
      className={cn(
        "capsule flex gap-3 p-3",
        index % 2 ? "capsule--alt" : "",
      )}
    >
      <span className="shell-art block h-24 w-16 shrink-0">
        {/* Keyed by URL, because a suggestion's cover comes from a provider and
            has no book id. Cached on the device like every other cover, so the
            same resolver -- and the same three states -- apply here. */}
        {recommendation.coverUrl ? (
          /* No `display: contents`: see ShellCover. A boxless wrapper never
             intersects, so its cover would never be fetched. */
          <CoverImage cacheKey={urlCoverKey(recommendation.coverUrl)} />
        ) : (
          <img src="/placeholder-cover.svg" alt="" aria-hidden="true" className="h-full w-full object-cover" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-display text-[15px] font-semibold text-ink">{recommendation.title}</h3>
        <p className="truncate text-[12.5px] text-ink2">{recommendation.author ?? copy.unknownAuthor}</p>
        {recommendation.narrators.length > 0 && (
          <p className="mt-0.5 truncate text-[11.5px] text-ink3">
            {copy.narratedBy(recommendation.narrators.slice(0, 3).join(", "))}
          </p>
        )}
        {recommendation.description && (
          <p className="mt-1.5 line-clamp-2 text-[11.5px] text-ink3">{recommendation.description}</p>
        )}
        {/*
          These come from Open Library, which catalogues *print* editions. There
          is no narrator and no runtime, so the card must not imply this is
          something you can play. The wishlist is the point: it remembers a
          title worth hunting down, and "mark as owned" closes the loop when it
          turns up as an audiobook.
        */}
        <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-ink3">
          {copy.discover.notAnAudiobook}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-ink/25 bg-sunk px-2.5 py-0.5 text-[11px] font-bold text-ink2">
            {recommendation.reason}
          </span>
          <Btn size="sm" variant={saved ? "quiet" : "plain"} onClick={onSave} disabled={saved}>
            {saved ? <Check size={13} aria-hidden="true" /> : <Plus size={13} aria-hidden="true" />}
            {saved ? copy.discover.onYourWishlist : copy.discover.saveToWishlist}
          </Btn>
        </div>
      </div>
    </article>
  );
}

function WishlistRow({ item, onRemove, onMarkOwned }: { item: WishlistItem; onRemove: () => void; onMarkOwned: (owned: boolean) => void }) {
  return (
    <article className="panel flex items-start gap-3 p-3">
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-display text-[15px] font-semibold text-ink">{item.title}</h3>
        <p className="truncate text-[12.5px] text-ink2">{item.author ?? copy.unknownAuthor}</p>
        {/* Wishlist books are metadata-only; there is deliberately no play control. */}
        <p className="mt-1 text-[11.5px] text-ink3">{copy.discover.notInLibrary}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Btn
          size="sm"
          variant="quiet"
          onClick={() => onMarkOwned(!item.owned)}
          aria-pressed={item.owned}
          title={item.owned ? copy.discover.owned : copy.discover.markAsOwned}
          aria-label={copy.discover.markOwned(item.title)}
          className={item.owned ? "bg-mint text-white" : ""}
        >
          <Check size={15} aria-hidden="true" />
        </Btn>
        <Btn size="sm" variant="quiet" onClick={onRemove} aria-label={copy.discover.removeFromWishlist(item.title)} className="text-rasp-ink">
          <Trash2 size={15} aria-hidden="true" />
        </Btn>
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
      return { tone: "warn", text: copy.discover.offline };
    case "insufficient-metadata":
      return { tone: "info", text: result.message ?? copy.discover.notEnoughMetadata };
    case "no-results":
      return { tone: "info", text: result.message ?? copy.discover.noNewTitles };
    default:
      return null;
  }
}

export function Discover({ discover, hasFavourites }: { discover: ReturnType<typeof useDiscover>; hasFavourites: boolean }) {
  const [saved, setSaved] = useState<Set<string>>(new Set());

  // Destructured so the dependency list names *functions*, which are stable
  // `useCallback`s, rather than `discover` itself, which is a fresh object on
  // every render.
  //
  // Depending on the object made this effect re-run after every state change --
  // including the `loadingMore` flag that "Show 5 more" sets. The click therefore
  // fetched page 2 and then immediately re-fetched page 1 over the top of it, and
  // the button appeared to do nothing. Nothing errored; the list simply never
  // grew past five.
  const { loadWishlist, loadForMe } = discover;

  useEffect(() => {
    void loadWishlist();
    // Discover is computed on demand (spec 19), so opening the tab is the
    // trigger -- not a background job.
    if (hasFavourites) void loadForMe();
  }, [loadWishlist, loadForMe, hasFavourites]);

  const { result, wishlist, loading, error } = discover;
  const notice = result ? statusMessage(result) : null;

  return (
    <div className="space-y-9">
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-[30px] leading-[1.05] sm:text-4xl">
              <Compass size={26} className="text-rasp" aria-hidden="true" /> {copy.discover.heading}
            </h2>
            <p className="mt-2 text-ink2">{copy.discover.intro}</p>
          </div>
          <Btn
            onClick={() => void discover.loadForMe()}
            disabled={loading || !hasFavourites}
            className="shrink-0"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} aria-hidden="true" /> {copy.discover.refresh}
          </Btn>
        </div>

        {/* The empty state here is the common case on a fresh install, so it is
            a panel with the explanation given real weight rather than a grey
            line of text. It does not invent a feature: favourites are the only
            input Discover has. */}
        {!hasFavourites && (
          <div className="panel panel--sunk px-5 py-8 text-center">
            <span className="mx-auto grid size-14 -rotate-6 place-items-center rounded-[18px_14px_18px_14px/14px_18px_14px_18px] border-2 border-ink bg-sunk">
              <Compass size={24} className="text-ink3" aria-hidden="true" />
            </span>
            <p className="mx-auto mt-4 max-w-md text-[14px] leading-relaxed text-ink2">
              {copy.discover.needsFavourites}
            </p>
          </div>
        )}
        {error && <Notice tone="error" role="alert" className="mb-4">{error}</Notice>}
        {notice && (
          <Notice tone={notice.tone} className="mb-4">
            {notice.text}
          </Notice>
        )}

        {result?.recommendations.length ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {result.recommendations.map((recommendation, index) => {
                const key = `${recommendation.provider}:${recommendation.providerKey ?? recommendation.title}`;
                return (
                  <RecommendationCard
                    key={key}
                    index={index}
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

            {/*
              "Show 5 more" -- the shape the tester asked for by name.

              The page is a slice of one ranking computed on the server, so what
              arrives next continues the list rather than replacing it. That is
              the whole difference between paging and "more results, who knows
              which", and it is why the button appends and the server caches.
            */}
            {result.hasMore && (
              <div className="mt-6 flex flex-col items-center gap-2">
                <Btn variant="quiet" onClick={() => void discover.loadMore()} disabled={discover.loadingMore}>
                  {discover.loadingMore ? (
                    <>
                      <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />
                      {copy.discover.findingMore}
                    </>
                  ) : (
                    copy.discover.showMore
                  )}
                </Btn>
                {typeof result.total === "number" && (
                  <p className="text-[12px] text-ink3 tnum">
                    {copy.discover.showing(result.recommendations.length, result.total)}
                  </p>
                )}
              </div>
            )}
          </>
        ) : null}
      </section>

      <section aria-labelledby="wishlist">
        <MachineHead id="wishlist" title={copy.discover.wishlistHeading} count={`${wishlist.length}`} />
        {wishlist.length === 0 ? (
          <p className="panel panel--sunk px-4 py-6 text-center text-[13.5px] text-ink2">
            {copy.discover.wishlistEmpty}
          </p>
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