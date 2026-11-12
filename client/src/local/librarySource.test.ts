import { describe, expect, it } from "vitest";
import type { Audiobook } from "../types";
import { mergeShelves, type LibrarySource } from "./librarySource";

/**
 * The library source seam.
 *
 * The listener's shelf is one concept with two implementations: the books the
 * server holds, and the books this device holds. They were merged by hand in
 * `App.tsx`, with the key format written out inline in both places, so a
 * change to the format would silently produce duplicate shelf entries.
 *
 * The merge belongs here, with the key format it uses.
 */

function book(id: number, extra: Partial<Audiobook> = {}): Audiobook {
  return { id, title: `Book ${id}`, author: "Someone", ...extra } as unknown as Audiobook;
}

const SERVER = "https://home.example";

describe("mergeShelves", () => {
  it("filters device-side books for a child with the offline ladder (spec 38)", () => {
    const merged = mergeShelves(
      null,
      { books: [book(1, { minimumAge: 4 }), book(2, { minimumAge: 9 }), book(3, { minimumAge: null })] },
      SERVER,
      { role: "child", ageBand: "under-6" },
    );
    expect(merged.map((item) => item.id)).toEqual([1, 3]);
  });

  it("prefers the server book when both shelves hold the same key", () => {
    // The server has just confirmed the shelf, so its copy is the truer one.
    const merged = mergeShelves(
      { books: [book(7, { title: "From the server" })], serverId: SERVER },
      { books: [book(7, { title: "From the device" })] },
      SERVER,
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe("From the server");
  });

  it("keeps a device book from another server", () => {
    // The device shelf is a union of per-server shelves (spec 30), so a book
    // adopted from somewhere else is a different book that also belongs on
    // the shelf.
    const merged = mergeShelves(
      { books: [book(7)], serverId: SERVER },
      { books: [book(7, { serverId: "https://other.example" })] },
      SERVER,
    );

    expect(merged.map((entry) => entry.id)).toEqual([7, 7]);
  });

  it("does not show the server shelf when the server could not be reached", () => {
    // Its last successful list is stale, and showing it beside the device's
    // books would show the listener a shelf that is no longer true.
    const merged = mergeShelves(
      null,
      { books: [book(7)] },
      SERVER,
    );

    expect(merged.map((entry) => entry.id)).toEqual([7]);
  });

  it("keeps the device's own books when the server shelf is gone", () => {
    const merged = mergeShelves(null, { books: [book(1), book(2)] }, SERVER);

    expect(merged.map((entry) => entry.id)).toEqual([1, 2]);
  });

  it("keys the books by server and id, not by id alone", () => {
    // Two servers can both number their books from 1. Keying by id alone would
    // make one of them disappear.
    const merged = mergeShelves(
      { books: [book(1)], serverId: "https://a.example" },
      { books: [book(1, { serverId: "https://b.example" })] },
      "https://a.example",
    );

    expect(merged).toHaveLength(2);
  });

  it("puts the server's books first", () => {
    const merged = mergeShelves(
      { books: [book(1)] },
      { books: [book(2)] },
      SERVER,
    );

    expect(merged.map((entry) => entry.id)).toEqual([1, 2]);
  });

  it("treats a source with no books as no books", () => {
    const merged = mergeShelves({ books: [] }, { books: [book(3)] }, SERVER);

    expect(merged.map((entry) => entry.id)).toEqual([3]);
  });
});

describe("LibrarySource", () => {
  it("describes one shelf of books", () => {
    // The interface the two hooks share. A source that names its server
    // holds one server's catalogue; one that does not holds a union of
    // shelves, and its books are tagged individually.
    const single: LibrarySource = { books: [book(1)], serverId: SERVER };
    const union: LibrarySource = { books: [book(1, { serverId: "https://b.example" })] };

    expect(single.books).toHaveLength(1);
    expect(union.serverId).toBeUndefined();
  });
});
