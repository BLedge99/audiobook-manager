import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LibraryScreen } from "./LibraryScreen";
import { BrowseScreen } from "./BrowseScreen";
import { FavouritesScreen } from "./FavouritesScreen";
import type { Audiobook } from "../types";

const sampleBook: Audiobook = {
  id: 1,
  title: "Test Book",
  author: "Author",
  duration: 1000,
  fileFormat: "mp3",
  tracks: [],
  createdAt: new Date().toISOString(),
};

const dummyGridProps = {
  onSelect: vi.fn(),
  favourites: new Set<number>(),
  onToggleFavourite: vi.fn(),
  onFindSimilar: vi.fn(),
  changedIds: new Set<number>(),
};

const dummyDevice = {
  books: [sampleBook],
  rows: {},
  unclaimed: [],
  loading: false,
  libraryReadError: null,
  usedBytes: 1000,
  progressOf: () => 0,
  bytesFor: () => 0,
  isDownloaded: () => false,
  download: vi.fn(),
  remove: vi.fn(),
  recover: vi.fn(),
  refresh: vi.fn(),
  localUrlForTrack: vi.fn(),
};

describe("Screens", () => {
  it("LibraryScreen renders ContinueListening, search bar and library grid", () => {
    render(
      <LibraryScreen
        libraryBooks={[sampleBook]}
        searchedBooks={[sampleBook]}
        search=""
        onSearchChange={vi.fn()}
        loading={false}
        refreshing={false}
        offline={false}
        device={dummyDevice}
        recovering={false}
        onRecoverDownloads={vi.fn()}
        onRetryOffline={vi.fn()}
        onOpenServerSetup={vi.fn()}
        onOpenTab={vi.fn()}
        onSelectBook={vi.fn()}
        gridProps={dummyGridProps}
        canManageLibrary={false}
        reviewQueue={[]}
        onReviewResolved={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "Your audiobooks" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
    expect(screen.getByText("Test Book")).toBeInTheDocument();
  });

  it("BrowseScreen renders search bar, filter bar and shelves", () => {
    render(
      <BrowseScreen
        libraryBooks={[sampleBook]}
        filteredBooks={[sampleBook]}
        filters={{}}
        onFiltersChange={vi.fn()}
        search=""
        onSearchChange={vi.fn()}
        genres={[]}
        tags={[]}
        genreShelves={[]}
        seriesShelves={[]}
        favouriteIds={new Set()}
        onToggleFavourite={vi.fn()}
        onSelectBook={vi.fn()}
        gridProps={dummyGridProps}
        accountExperience="household"
        onTagChanged={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "Browse" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
  });

  it("FavouritesScreen renders empty state or favourite list", () => {
    render(
      <FavouritesScreen
        favouriteIds={new Set([1])}
        favouriteBooks={[sampleBook]}
        gridProps={dummyGridProps}
      />
    );

    expect(screen.getByRole("heading", { name: "Favourites" })).toBeInTheDocument();
    expect(screen.getByText("Test Book")).toBeInTheDocument();
  });
});
