import { SlidersHorizontal, X } from "lucide-react";
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
  { key: "genre", label: "Genre" },
  { key: "author", label: "Author" },
  { key: "narrator", label: "Narrator" },
  { key: "series", label: "Series" },
  { key: "tag", label: "Tags" },
];

function Chip({
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
}

function FacetGroup({
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
  const options = facetOptions(books, facet, facet === "genre" ? genreLabels : undefined);
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
            clear
          </button>
        )}
      </div>
      {/* `-mx-1 px-1` lets the chips bleed to the screen edge without the
          scrollbar sitting on top of the first chip. */}
      <div
        className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible"
        role="group"
        aria-label={`Filter by ${label.toLowerCase()}`}
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
}

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
  const genreLabels = new Map<string, string>();
  for (const parent of genres) {
    for (const child of parent.children ?? []) {
      genreLabels.set(child.slug, child.name);
    }
    genreLabels.set(parent.slug, parent.name);
  }

  const active = activeFilterCount(filters);

  return (
    <section className="panel mb-8 p-4 sm:p-5" aria-labelledby="filter-bar">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id="filter-bar" className="flex items-center gap-2 font-display text-[17px] font-semibold text-ink">
          <SlidersHorizontal size={17} aria-hidden="true" className="text-rasp" />
          Filter
        </h2>
        {isFilterActive(filters) && (
          <button
            type="button"
            onClick={() => onChange({})}
            className="btn btn--sm"
          >
            <X size={14} aria-hidden="true" /> Clear {active}
          </button>
        )}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        {FACETS.map((facet) => (
          <FacetGroup
            key={facet.key}
            facet={facet.key}
            label={facet.label}
            books={books}
            filters={filters}
            genreLabels={genreLabels}
            onToggle={(target, value) => onChange(toggleFilter(filters, target, value))}
            onClear={(target) => onChange(clearFacet(filters, target))}
          />
        ))}
      </div>
    </section>
  );
}