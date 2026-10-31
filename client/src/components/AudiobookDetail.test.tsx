import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AudiobookDetail } from "./AudiobookDetail";
import type { Audiobook } from "../types";

/**
 * Spec 15b feature 5 — the player is the top of the book page.
 *
 * The tester put it plainly: "the player for books should be at the top rather
 * than below a load of info like tags etc... the most common reason for opening
 * a book is to play it". The detail page used to end with the player, after
 * tags, series, description and the online metadata lookup.
 *
 * These tests pin the *order* rather than the styling, because DOM order is what
 * decides what a phone shows first.
 */

function book(overrides: Partial<Audiobook> = {}): Audiobook {
  return {
    id: 7,
    title: "The Book",
    author: "An Author",
    fileFormat: "mp3",
    duration: 7200,
    description: "A description nobody asked for yet.",
    tracks: [{ id: 1, trackNumber: 1, title: "Section 01", duration: 7200 }],
    contributors: [{ id: 1, name: "A Narrator", role: "narrator" }],
    customTags: [],
    genres: [],
    ...overrides,
  } as unknown as Audiobook;
}

let fetchMock: ReturnType<typeof vi.fn>;

/**
 * A tag suite shaped like the real one.
 *
 * `TagSuiteEditor` reads `suite.genres.map(...)` while seeding its draft, so a
 * stub of `{}` does not fail quietly -- it throws inside the component and
 * unmounts the tree, which looks exactly like the fold never opening.
 */
const TAG_SUITE = {
  id: 7,
  title: "The Book",
  subtitle: null,
  author: "An Author",
  description: "A description nobody asked for yet.",
  publisher: null,
  publishedYear: null,
  language: null,
  unabridged: false,
  isbn: null,
  series: null,
  genres: [],
  contributors: [],
  metadataSource: "embedded",
  enrichmentStatus: "applied",
  overriddenFields: [],
};

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () => (String(url).includes("/tags") ? TAG_SUITE : {}),
    text: async () => "{}",
  }));
  vi.stubGlobal("fetch", fetchMock);
  window.localStorage.setItem("profileId", "1");
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

/**
 * Is `second` after `first` in document order?
 *
 * `getBoundingClientRect` is the obvious choice and is useless here: jsdom does
 * no layout, so every rect is 0x0 and every comparison is `0 > 0`. Document
 * order is the thing being asserted anyway -- it is what decides what a phone
 * stacks first.
 */
function precedes(first: Element, second: Element): boolean {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe("AudiobookDetail", () => {
  it("puts the player above the metadata, not below it", async () => {
    render(<AudiobookDetail book={book()} onClose={() => {}} genres={[]} tags={[]} />);

    const player = screen.getByLabelText("Audiobook player");
    const title = screen.getByRole("heading", { name: "The Book" });
    const facts = screen.getByText("2h 0m");

    // The player comes after the title -- it needs to know what it is playing --
    // and before the facts and everything the fold holds.
    expect(precedes(title, player)).toBe(true);
    expect(precedes(player, facts)).toBe(true);

    // Nothing above the player is metadata. This is the actual complaint: the
    // player used to be the last element on the page, under tags, series,
    // description and the online metadata lookup.
    const above = Array.from(document.querySelectorAll("article p, article h2, article button"))
      .filter((el) => precedes(el, player))
      .map((el) => el.textContent?.trim() ?? "");
    expect(above.join(" ")).not.toMatch(/description|series|find metadata/i);
  });

  it("hides the metadata, tags and lookup until the fold is opened", async () => {
    const user = userEvent.setup();
    render(<AudiobookDetail book={book()} onClose={() => {}} genres={[]} tags={[]} />);

    const toggle = screen.getByRole("button", { name: /book details/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", "book-details");

    // The `Details` panel is where series, description, genres and tags are
    // shown -- as readable text when it is not being edited -- so its absence
    // is the honest check that nothing metadata is on screen yet.
    expect(screen.queryByRole("region", { name: "Details" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /find metadata online/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/A description nobody asked for yet/)).not.toBeInTheDocument();

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const panel = screen.getByRole("region", { name: "Details" });
    expect(within(panel).getByText(/A description nobody asked for yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /find metadata online/i })).toBeInTheDocument();
    expect(document.getElementById("book-details")).toBeInTheDocument();

    await user.click(toggle);
    expect(screen.queryByRole("region", { name: "Details" })).not.toBeInTheDocument();
  });

  it("does not fetch the tag suite until the fold is opened", async () => {
    // The reason the fold's contents are a separate component. `useTagSuite`
    // fetches on mount, so an inline editor behind a disclosure would still
    // spend a request on every book open -- on a phone over a home LAN.
    const user = userEvent.setup();
    render(<AudiobookDetail book={book()} onClose={() => {}} genres={[]} tags={[]} />);

    const suiteCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes("/tags")).length;
    expect(suiteCalls()).toBe(0);

    await user.click(screen.getByRole("button", { name: /book details/i }));
    await waitFor(() => expect(suiteCalls()).toBe(1));
  });

  it("keeps the listener's own actions above the fold", async () => {
    render(
      <AudiobookDetail
        book={book()}
        onClose={() => {}}
        onToggleFavourite={() => {}}
        onFindSimilar={() => {}}
      />,
    );

    const favourite = screen.getByRole("button", { name: /add to favourites/i });
    const player = screen.getByLabelText("Audiobook player");
    // Both are things a listener does next, so neither waits behind metadata.
    expect(precedes(player, favourite)).toBe(true);
  });

  /**
   * Spec 27: removing a book from the profile's library.
   *
   * The asymmetry is the point. Leaving the library is recoverable -- the book
   * stays on the server and the Server library tab can add it back -- so it is
   * not worth a question. Deleting the *download* is not recoverable, so that
   * is the one worth asking about, and only when there is a download.
   */
  describe("removing a book from your library", () => {
    it("offers the action when the book can be removed", () => {
      render(
        <AudiobookDetail book={book()} onClose={() => {}} onRemoveFromLibrary={async () => {}} />,
      );
      expect(screen.getByRole("button", { name: /remove from my library/i })).toBeInTheDocument();
    });

    it("offers nothing when the action is not available", () => {
      render(<AudiobookDetail book={book()} onClose={() => {}} />);
      expect(screen.queryByRole("button", { name: /remove from my library/i })).not.toBeInTheDocument();
    });

    it("removes straight away when there is no download to ask about", async () => {
      const user = userEvent.setup();
      const onRemoveFromLibrary = vi.fn(async () => undefined);
      render(
        <AudiobookDetail
          book={book()}
          onClose={() => {}}
          onRemoveFromLibrary={onRemoveFromLibrary}
          isDownloaded={false}
        />,
      );

      await user.click(screen.getByRole("button", { name: /remove from my library/i }));
      await waitFor(() => expect(onRemoveFromLibrary).toHaveBeenCalledWith(7));
      // No question was asked, because there was nothing irreversible to ask about.
      expect(screen.queryByText(/Delete the download as well/)).not.toBeInTheDocument();
    });

    it("asks about the download before removing a downloaded book", async () => {
      const user = userEvent.setup();
      const onRemoveFromLibrary = vi.fn(async () => undefined);
      render(
        <AudiobookDetail
          book={book()}
          onClose={() => {}}
          onRemoveFromLibrary={onRemoveFromLibrary}
          isDownloaded={true}
        />,
      );

      await user.click(screen.getByRole("button", { name: /remove from my library/i }));

      // The question names the consequence, and both answers are on screen.
      expect(screen.getByText(/Delete the download as well/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /delete it/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /keep the download/i })).toBeInTheDocument();
      // Nothing has been removed yet -- the question is still open.
      expect(onRemoveFromLibrary).not.toHaveBeenCalled();
    });

    it("deletes the download too when that is the answer", async () => {
      const user = userEvent.setup();
      const onRemoveFromLibrary = vi.fn(async () => undefined);
      const onDeleteDownload = vi.fn(async () => ({ failed: [] }));
      render(
        <AudiobookDetail
          book={book()}
          onClose={() => {}}
          onRemoveFromLibrary={onRemoveFromLibrary}
          onDeleteDownload={onDeleteDownload}
          isDownloaded={true}
        />,
      );

      await user.click(screen.getByRole("button", { name: /remove from my library/i }));
      // `fireEvent`, not `user.click`: answering removes the panel, so the
      // button that was clicked leaves the DOM mid-click. `userEvent` does not
      // recover from that -- it waits for the detached element for ever, and
      // leaves the document's pointer state dirty for every later click.
      fireEvent.click(screen.getByRole("button", { name: /delete it/i }));

      await waitFor(() => expect(onDeleteDownload).toHaveBeenCalledWith(7, book().serverId));
      expect(onRemoveFromLibrary).toHaveBeenCalledWith(7);
    });

    it("keeps the download when that is the answer", async () => {
      const user = userEvent.setup();
      const onRemoveFromLibrary = vi.fn(async () => undefined);
      const onDeleteDownload = vi.fn(async () => ({ failed: [] }));
      render(
        <AudiobookDetail
          book={book()}
          onClose={() => {}}
          onRemoveFromLibrary={onRemoveFromLibrary}
          onDeleteDownload={onDeleteDownload}
          isDownloaded={true}
        />,
      );

      await user.click(screen.getByRole("button", { name: /remove from my library/i }));
      // `fireEvent`, not `user.click` -- see the note above.
      fireEvent.click(screen.getByRole("button", { name: /keep the download/i }));

      await waitFor(() => expect(onRemoveFromLibrary).toHaveBeenCalledWith(7));
      // The download was not touched.
      expect(onDeleteDownload).not.toHaveBeenCalled();
    });
  });

  it("still renders the essentials the fold took over", async () => {
    render(
      <AudiobookDetail
        book={book({ series: { id: 1, name: "A Series" }, seriesPosition: 2 } as never)}
        onClose={() => {}}
      />,
    );

    // Duration, format and narrator stay visible: they decide *whether* to play.
    expect(screen.getByText("2h 0m")).toBeInTheDocument();
    expect(screen.getByText("MP3")).toBeInTheDocument();
    expect(screen.getByText(/Narrated by A Narrator/)).toBeInTheDocument();

    // Series is metadata, so it moved into the fold with everything else.
    expect(screen.queryByText(/A Series/)).not.toBeInTheDocument();
  });
});
