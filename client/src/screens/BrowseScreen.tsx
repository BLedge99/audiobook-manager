import type { Audiobook, GenreNode, TagSummary } from "../types";
import { AudiobookGrid } from "../components/AudiobookGrid";
import { FilterBar } from "../components/FilterBar";
import { SearchBar } from "../components/SearchBar";
import { Shelves } from "../components/Shelves";
import type { Shelf } from "../lib/browse";
import { TagManager } from "../components/TagManager";
import { MachineHead } from "../ui/primitives";
import { copy, plural } from "../copy";
import { isFilterActive, type Filters } from "../lib/browse";

export interface BrowseScreenProps {
  libraryBooks: Audiobook[];
  filteredBooks: Audiobook[];
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  search: string;
  onSearchChange: (search: string) => void;
  genres: GenreNode[];
  tags: TagSummary[];
  genreShelves: Shelf[];
  seriesShelves: Shelf[];
  favouriteIds: Set<number>;
  onToggleFavourite: (bookId: number) => void;
  onSelectBook: (book: Audiobook) => void;
  gridProps: {
    onSelect: (book: Audiobook) => void;
    favourites: Set<number>;
    onToggleFavourite: (bookId: number) => void;
    onFindSimilar: (book: Audiobook) => void;
    changedIds: Set<number>;
  };
  accountExperience: "household" | "demo";
  onTagChanged: () => void;
}

export function BrowseScreen({
  libraryBooks,
  filteredBooks,
  filters,
  onFiltersChange,
  search,
  onSearchChange,
  genres,
  tags,
  genreShelves,
  seriesShelves,
  favouriteIds,
  onToggleFavourite,
  onSelectBook,
  gridProps,
  accountExperience,
  onTagChanged,
}: BrowseScreenProps) {
  return (
    <>
      <section className="mb-7">
        <h2 className="text-[30px] leading-[1.05] sm:text-4xl">{copy.browse.heading}</h2>
        <p className="mt-2 max-w-xl text-ink2">{copy.browse.intro}</p>
      </section>

      <SearchBar value={search} onChange={onSearchChange} resultCount={filteredBooks.length} />
      <FilterBar books={libraryBooks} filters={filters} onChange={onFiltersChange} genres={genres} />

      {isFilterActive(filters) || search.trim().length > 0 ? (
        <section>
          <MachineHead title={copy.browse.filteredHeading} count={plural(filteredBooks.length, "book")} />
          <AudiobookGrid
            books={filteredBooks}
            emptyMessage={copy.library.noMatches}
            {...gridProps}
          />
        </section>
      ) : (
        <>
          <Shelves
            shelves={genreShelves}
            onSelect={onSelectBook}
            favouriteIds={favouriteIds}
            onToggleFavourite={onToggleFavourite}
            emptyMessage={copy.browse.noGenreShelves}
          />
          {seriesShelves.length > 0 && (
            <section className="mt-4">
              <MachineHead title={copy.browse.seriesHeading} />
              <Shelves
                shelves={seriesShelves}
                onSelect={onSelectBook}
                favouriteIds={favouriteIds}
                onToggleFavourite={onToggleFavourite}
              />
            </section>
          )}
        </>
      )}

      {accountExperience !== "demo" && (
        <div className="mt-10">
          <TagManager tags={tags} onChanged={onTagChanged} />
        </div>
      )}
    </>
  );
}
