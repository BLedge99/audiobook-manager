import { describe, it, expect } from "vitest";
import { bookCoverKey } from "./CoverImage";
import { replicaBookKey } from "./replica";

/**
 * `<serverId>#<bookId>` has one home: replicaBookKey (spec 37 step 2.2).
 * Anything keyed off a book must spell the composite key the same way.
 */
describe("one spelling of the composite key (spec 41 step 9.2)", () => {
  it("bookCoverKey is book: + replicaBookKey", () => {
    expect(bookCoverKey(7, "https://a.example")).toBe(`book:${replicaBookKey("https://a.example", 7)}`);
    expect(bookCoverKey(7)).toBe(`book:${replicaBookKey("", 7)}`);
  });

  it("replicaBookKey is the DB key format and the JSX key format", () => {
    expect(replicaBookKey("https://a.example", 7)).toBe("https://a.example#7");
    expect(replicaBookKey("", 7)).toBe("#7");
  });
});
