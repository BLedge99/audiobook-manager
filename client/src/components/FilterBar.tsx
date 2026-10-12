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

/**
 * Spec 20 — the filter bar.
 *
 * Chip groups above the grid for Genre, Author, Narrator, Series and the
 * household's custom tags. Filtering rules themselves live in `lib/browse.ts`
 * and are unit-tested there; this component only renders and dispatches.
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
      className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs transition ${
        active
          ? "border-cyan-400 bg-cyan-400 text-slate-950"
          : "border-slate-700 bg-slate-900 text-slate-300 hover:border-cyan-500/70 hover:text-white"
      }`}
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
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-500">{label}</h3>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => onClear(facet)}
            className="text-xs text-cyan-400 hover:text-cyan-300"
          >
            clear
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label={`Filter by ${label.toLowerCase()}`}>
        {options.map((option) => (
          <Chip key={option.value} active={selected.includes(option.value)} onClick={() => onToggle(facet, option.value)}>
            {option.label} <span className={selected.includes(option.value) ? "opacity-70" : "text-slate-500"}>{option.count}</span>
          </Chip>
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
    <section className="mb-8 border border-slate-800 bg-slate-900/50 p-4" aria-labelledby="filter-bar">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id="filter-bar" className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-slate-400">
          <SlidersHorizontal size={15} aria-hidden="true" /> Filter
        </h2>
        {isFilterActive(filters) && (
          <button
            type="button"
            onClick={() => onChange({})}
            className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300"
          >
            <X size={13} aria-hidden="true" /> Clear {active}
          </button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
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