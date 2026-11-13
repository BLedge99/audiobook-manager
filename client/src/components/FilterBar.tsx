import { SlidersHorizontal, X } from "lucide-react";
import { memo, useCallback, useMemo, type CSSProperties } from "react";
import { copy } from "../copy";
import {
  activeFilterCount,
  clearFacet,
  facetOptions,
  isFilterActive,
  toggleFilter,
  type FacetKey,
  type Filters,
} from "../lib/browse";
import type { Audiobook, GenreNode } from "../types";
import { cn } from "../ui/primitives";

/**
 * Spec 20 -- the filter bar.
 *
 * Chip groups above the grid for Genre, Author, Narrator, Series and the
 * household's custom tags. Filtering rules themselves live in `lib/browse.ts`
 * and are unit-tested there; this component only renders and dispatches.
 *
 * Each group scrolls sideways on a phone rather than wrapping: a genre taxonomy
 * with fifty children turns a wrapped layout into a wall, and the facet a
 * listener wants is never the one on screen.
 */

const FACETS: { key: FacetKey; label: string }[] = [
  { key: "genre", label: copy.filters.facets.genre },
  { key: "author", label: copy.filters.facets.author },
  { key: "narrator", label: copy.filters.facets.narrator },
  { key: "series", label: copy.filters.facets.series },
  { key: "tag", label: copy.filters.facets.tag },
];

const Chip = memo(function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn("chip", active && "bg-ink text-surface border-ink")}
    >
      {children}
    </button>
  );
});

const FacetGroup = memo(function FacetGroup({
  facet,
  label,
  books,
  filters,
  onToggle,
  genreLabels,
  onClear,
}: {
  facet: FacetKey;
  label: string;
  books: Audiobook[];
  filters: Filters;
  onToggle: (facet: FacetKey, value: string) => void;
  genreLabels: Map<string, string>;
  onClear: (facet: FacetKey) => void;
}) {
  // Facet counts are five O(N) passes with a sort each; they must not
  // recompute on every render of the bar.
  const options = useMemo(
    () => facetOptions(books, facet, facet === "genre" ? genreLabels : undefined),
    [books, facet, genreLabels],
  );
  if (options.length === 0) return null;

  const selected = filters[facet] ?? [];

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="font-display text-[15px] font-semibold text-ink">{label}</h3>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => onClear(facet)}
            className="text-[12.5px] font-bold text-rasp-ink underline decoration-dotted underline-offset-4 hover:decoration-solid"
          >
            {copy.filters.clear}
          </button>
        )}
      </div>
      {/* `-mx-2 px-2` bleeds the chips to the screen edge on a phone; from
          `sm` up they wrap instead. Clipping room and the bleed itself live
          in `.scroll-bleed`, tuned here via `--bleed`/`--clip-pad`. */}
      <div
        className="scroll-bleed snap-x sm:flex-wrap sm:overflow-visible"
        style={{ "--bleed": "0.5rem", "--clip-pad": "0.5rem", "--scroll-gap": "0.5rem" } as CSSProperties}
        role="group"
        aria-label={copy.filters.groupLabel(label)}
      >
        {options.map((option) => (
          <span key={option.value} className="snap-start">
            <Chip active={selected.includes(option.value)} onClick={() => onToggle(facet, option.value)}>
              {option.label}{" "}
              <span className={cn("tnum", selected.includes(option.value) ? "opacity-70" : "text-ink3")}>
                {option.count}
              </span>
            </Chip>
          </span>
        ))}
      </div>
    </div>
  );
});

export function FilterBar({
  books,
  filters,
  onChange,
  genres,
}: {
  books: Audiobook[];
  filters: Filters;
  onChange: (filters: Filters) => void;
  genres: GenreNode[];
}) {
  // Flatten the taxonomy so a second-level genre shows its parent as context
  // ("Science Fiction" under "Sci-Fi & Fantasy") rather than a bare slug.
  const genreLabels = useMemo(() => {
    const labels = new Map<string, string>();
    for (const parent of genres) {
      for (const child of parent.children ?? []) {
        labels.set(child.slug, child.name);
      }
      labels.set(parent.slug, parent.name);
    }
    return labels;
  }, [genres]);

  const active = activeFilterCount(filters);
  const onToggle = useCallback(
    (target: FacetKey, value: string) => onChange(toggleFilter(filters, target, value)),
    [onChange, filters],
  );
  const onClear = useCallback(
    (target: FacetKey) => onChange(clearFacet(filters, target)),
    [onChange, filters],
  );

  return (
    <section className="panel mb-8 p-4 sm:p-5" aria-labelledby="filter-bar">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id="filter-bar" className="flex items-center gap-2 font-display text-[17px] font-semibold text-ink">
          <SlidersHorizontal size={17} aria-hidden="true" className="text-rasp" />
          {copy.filters.heading}
        </h2>
        {isFilterActive(filters) && (
          <button
            type="button"
            onClick={() => onChange({})}
            className="btn btn--sm"
          >
            <X size={14} aria-hidden="true" /> {copy.filters.clearCount(active)}
          </button>
        )}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2">
        {FACETS.map((facet) => (
          <FacetGroup
            key={facet.key}
            facet={facet.key}
            label={facet.label}
            books={books}
            filters={filters}
            genreLabels={genreLabels}
            onToggle={onToggle}
            onClear={onClear}
          />
        ))}
      </div>
    </section>
  );
}