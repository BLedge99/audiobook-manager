import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { FilterBar } from "./FilterBar";
import * as browse from "../lib/browse";
import type { Audiobook } from "../types";

/**
 * Facet counts are five O(N) passes with a sort each. They used to run on
 * every FilterBar render -- and FilterBar re-renders on every debounced
 * search keystroke, because App re-renders wholesale.
 */
const NO_GENRES: import("../types").GenreNode[] = [];
const books = [
  { id: 1, title: "One", author: "A", genre: "Mystery", tracks: [], narrators: [] },
  { id: 2, title: "Two", author: "B", genre: "Mystery", tracks: [], narrators: [] },
] as unknown as Audiobook[];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FilterBar", () => {
  it("computes facet options once per books identity, not per render", () => {
    const spy = vi.spyOn(browse, "facetOptions");
    const noop = () => {};
    const emptyFilters = {};
    const { rerender } = render(
      <FilterBar books={books} filters={emptyFilters} onChange={noop} genres={NO_GENRES} />,
    );
    expect(spy).toHaveBeenCalledTimes(5);
    rerender(<FilterBar books={books} filters={emptyFilters} onChange={noop} genres={NO_GENRES} />);
    expect(spy).toHaveBeenCalledTimes(5);
  });

  it("recomputes facet options when the books change", () => {
    const spy = vi.spyOn(browse, "facetOptions");
    const noop = () => {};
    const emptyFilters = {};
    const { rerender } = render(
      <FilterBar books={books} filters={emptyFilters} onChange={noop} genres={NO_GENRES} />,
    );
    const moreBooks = [
      ...books,
      { id: 3, title: "Three", author: "A", genre: "Fantasy", tracks: [], narrators: [] },
    ] as unknown as Audiobook[];
    rerender(<FilterBar books={moreBooks} filters={emptyFilters} onChange={noop} genres={NO_GENRES} />);
    expect(spy).toHaveBeenCalledTimes(10);
  });
});
