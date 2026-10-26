import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Discover } from "./Discover";
import type { useDiscover } from "../useBrowse";
import type { Recommendation } from "../types";

/**
 * Spec 15b feature 3 — Discover's "Show 5 more".
 *
 * The tester asked for this shape by name: "maybe display top 5 at a time, then
 * allow a 'load more' button", alongside a complaint that results came back
 * "at random".
 *
 * These tests cover the control itself. That the pages are *continuations of one
 * ranking* rather than fresh draws is server behaviour, asserted in
 * `recommend-service.test.ts`; the client half is that it appends and never
 * empties what is on screen.
 */

type DiscoverHook = ReturnType<typeof useDiscover>;

function recommendation(n: number): Recommendation {
  return {
    title: `Suggestion ${n}`,
    author: "An Author",
    narrators: [],
    genres: ["horror"],
    provider: "openlibrary",
    providerKey: `/works/${n}`,
    score: 1 - n / 100,
    reason: { code: "shared-genre", genre: "horror" },
  } as unknown as Recommendation;
}

function makeDiscover(overrides: Partial<DiscoverHook> = {}): DiscoverHook {
  return {
    result: {
      status: "ok",
      recommendations: [1, 2, 3, 4, 5].map(recommendation),
      page: 1,
      pageSize: 5,
      hasMore: true,
      total: 12,
    },
    wishlist: [],
    loading: false,
    loadingMore: false,
    error: undefined,
    loadForMe: vi.fn(async () => undefined),
    loadSimilar: vi.fn(async () => undefined),
    loadMore: vi.fn(async () => undefined),
    loadWishlist: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    markOwned: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as DiscoverHook;
}

beforeEach(() => {
  window.localStorage.setItem("profileId", "1");
});

describe("Discover pagination", () => {
  it("shows five suggestions and offers to show more", () => {
    render(<Discover discover={makeDiscover()} hasFavourites />);

    const cards = screen.getAllByRole("article").filter((a) => /Suggestion \d/.test(a.textContent ?? ""));
    expect(cards).toHaveLength(5);
    expect(screen.getByRole("button", { name: "Show 5 more" })).toBeInTheDocument();
  });

  it("asks for the next page when the button is used", async () => {
    const user = userEvent.setup();
    const discover = makeDiscover();
    render(<Discover discover={discover} hasFavourites />);

    await user.click(screen.getByRole("button", { name: "Show 5 more" }));
    expect(discover.loadMore).toHaveBeenCalledTimes(1);
  });

  it("offers nothing when there is no next page", () => {
    const discover = makeDiscover({
      result: {
        status: "ok",
        recommendations: [1, 2, 3].map(recommendation),
        page: 3,
        pageSize: 5,
        hasMore: false,
        total: 12,
      },
    } as Partial<DiscoverHook>);
    render(<Discover discover={discover} hasFavourites />);

    expect(screen.queryByRole("button", { name: "Show 5 more" })).not.toBeInTheDocument();
  });

  it("says how many are showing out of the total", () => {
    render(<Discover discover={makeDiscover()} hasFavourites />);
    // A button with no end in sight is worse than one that says what is left.
    expect(screen.getByText(/Showing 5 of 12/)).toBeInTheDocument();
  });

  it("disables the button and reports progress while the next page loads", async () => {
    const user = userEvent.setup();
    const discover = makeDiscover();
    const { rerender } = render(<Discover discover={discover} hasFavourites />);

    await user.click(screen.getByRole("button", { name: "Show 5 more" }));
    expect(discover.loadMore).toHaveBeenCalledTimes(1);

    // The hook owns `loadingMore`; the component only reflects it.
    rerender(<Discover discover={{ ...discover, loadingMore: true }} hasFavourites />);

    expect(screen.getByRole("button", { name: /Finding more/ })).toBeDisabled();
    // The ten suggestions already on screen stay on screen. "Load more" must
    // never blank the list it is appending to.
    expect(screen.getAllByRole("article").filter((a) => /Suggestion \d/.test(a.textContent ?? "")).length).toBe(5);
  });

  it("does not re-fetch page one after 'Show 5 more' is used", async () => {
    // A regression with no error message at all: the component's effect listed
    // the whole `discover` object in its dependencies, and that object is a new
    // literal on every render. So clicking "Show 5 more" set `loadingMore`,
    // re-rendered, re-ran the effect, and re-fetched page 1 over the top of the
    // page it had just appended. The button simply appeared to do nothing.
    const user = userEvent.setup();
    const discover = makeDiscover();
    const { rerender } = render(<Discover discover={discover} hasFavourites />);
    await waitFor(() => expect(discover.loadForMe).toHaveBeenCalledTimes(1));

    // One render caused by the interaction, as the real hook would do.
    await user.click(screen.getByRole("button", { name: "Show 5 more" }));
    rerender(<Discover discover={{ ...discover }} hasFavourites />);
    rerender(<Discover discover={{ ...discover, loadingMore: true }} hasFavourites />);

    // Still one. The effect must depend on the stable callbacks, not the object.
    expect(discover.loadForMe).toHaveBeenCalledTimes(1);
    expect(discover.loadWishlist).toHaveBeenCalledTimes(1);
  });

  it("still labels every card as a print book, since paging changes nothing about that", () => {
    // LIMITATIONS 1.8: these are Open Library print records with no narrator and
    // no runtime. A second page of them is still not an audiobook.
    render(<Discover discover={makeDiscover()} hasFavourites />);
    expect(screen.getAllByText(/not an audiobook yet/i).length).toBeGreaterThan(0);
  });
});
