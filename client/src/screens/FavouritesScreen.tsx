import type { Audiobook } from "../types";
import { AudiobookGrid } from "../components/AudiobookGrid";
import { copy } from "../copy";

export interface FavouritesScreenProps {
  favouriteIds: Set<number>;
  favouriteBooks: Audiobook[];
  gridProps: {
    onSelect: (book: Audiobook) => void;
    favourites: Set<number>;
    onToggleFavourite: (bookId: number) => void;
    onFindSimilar: (book: Audiobook) => void;
    changedIds: Set<number>;
  };
}

export function FavouritesScreen({
  favouriteIds,
  favouriteBooks,
  gridProps,
}: FavouritesScreenProps) {
  return (
    <section>
      <h2 className="text-[30px] leading-[1.05] sm:text-4xl">{copy.favourites.heading}</h2>
      <p className="mb-6 mt-2 max-w-xl text-ink2">
        {favouriteIds.size === 0 ? copy.favourites.empty : copy.favourites.count(favouriteIds.size)}
      </p>
      <AudiobookGrid
        books={favouriteBooks}
        emptyMessage={copy.library.noFavourites}
        {...gridProps}
      />
    </section>
  );
}
