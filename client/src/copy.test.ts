import { describe, it, expect } from "vitest";
import { copy, plural, verbFor } from "./copy";

/**
 * Spec 15b feature 7 — the copy table.
 *
 * The copy table is the one file every screen's wording comes from, so it is
 * the one file where a typo is invisible until someone uses the app. These
 * tests are deliberately about the *mechanics* rather than the wording, because
 * the wording is a judgement call and the mechanics are not.
 *
 * The failure that prompted this file: `plural(count, "match")` produced
 * "matchs", and the only thing that caught it was an unrelated component test
 * happening to assert the rendered string. The helper is now tested directly.
 */

describe("plural", () => {
  it("uses the singular for one", () => {
    expect(plural(1, "title")).toBe("1 title");
  });

  it("uses the plural for more than one", () => {
    expect(plural(2, "title")).toBe("2 titles");
    expect(plural(0, "title")).toBe("0 titles");
  });

  it("takes an irregular plural explicitly", () => {
    // The naive `+ "s"` would give "matchs", which is not a word.
    expect(plural(2, "match", "matches")).toBe("2 matches");
    expect(plural(1, "match", "matches")).toBe("1 match");
  });
});

describe("verbFor", () => {
  it("agrees with the count", () => {
    expect(verbFor(1, "is", "are")).toBe("is");
    expect(verbFor(3, "is", "are")).toBe("are");
  });

  it("produces a sentence that reads correctly", () => {
    expect(`${plural(1, "book")} ${verbFor(1, "is", "are")} part-finished`).toBe("1 book is part-finished");
    expect(`${plural(3, "book")} ${verbFor(3, "is", "are")} part-finished`).toBe("3 books are part-finished");
  });
});

describe("the copy table", () => {
  it("has no empty strings", () => {
    // An empty string renders as an invisible gap, and a gap is worse than a
    // wrong word because nothing announces it.
    const walk = (value: unknown, path: string) => {
      if (typeof value === "string") {
        expect(value, `${path} is empty`).not.toBe("");
        return;
      }
      if (typeof value === "function") return;
      if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
          walk(child, `${path}.${key}`);
        }
      }
    };
    walk(copy, "copy");
  });

  it("uses one ellipsis character everywhere, never three dots", () => {
    const walk = (value: unknown, path: string) => {
      if (typeof value === "string") {
        expect(value, `${path} uses "..." instead of "…"`).not.toMatch(/\.\.\./);
        return;
      }
      if (typeof value === "function") return;
      if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
          walk(child, `${path}.${key}`);
        }
      }
    };
    walk(copy, "copy");
  });

  it("has no exclamation marks", () => {
    // A confirmation is a fact, not an event.
    const walk = (value: unknown, path: string) => {
      if (typeof value === "string") {
        expect(value, `${path} has an exclamation mark`).not.toContain("!");
        return;
      }
      if (typeof value === "function") return;
      if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
          walk(child, `${path}.${key}`);
        }
      }
    };
    walk(copy, "copy");
  });

  it("keeps a shared phrase in one place, not two", () => {
    // "Use this" lived in `detail` and in `review`. Two entries, two places to
    // change, two chances to drift -- the exact problem this file exists to
    // solve, reproduced inside the fix. The shared phrases now live at the top
    // level, and these assertions fail if one is copied back into a surface.
    expect(copy.use).toBe("Use this");
    expect(copy.findMoreLikeThis).toBe("Find more like this");
    expect(copy.favourite.add).toBe("Add to favourites");
    expect(copy.favourite.inYours).toBe("In your favourites");
    expect(copy.unknownAuthor).toBe("Unknown author");

    // The surface groups must not re-declare them.
    expect("use" in copy.detail).toBe(false);
    expect("use" in copy.review).toBe(false);
    expect("findMoreLikeThis" in copy.detail).toBe(false);
    expect("findMoreLikeThis" in copy.card).toBe(false);
    expect("addToFavourites" in copy.detail).toBe(false);
    expect("inYourFavourites" in copy.detail).toBe(false);
    expect("unknownAuthor" in copy.discover).toBe(false);
    expect("unknownAuthor" in copy.review).toBe(false);
    expect("narratedBy" in copy.detail).toBe(false);
    expect("narratedBy" in copy.review).toBe(false);
    expect("narratedBy" in copy.card).toBe(false);
  });

  it("does not spell the same phrase two different ways", () => {
    // A duplicated *long* phrase is almost always the same sentence written
    // twice -- the drift this file is meant to prevent. Short words are
    // allowed to repeat, because "Browse" is a tab name and a section heading
    // and "Save" is a button in two different surfaces.
    const ALLOWED_DUPLICATES = new Set([
      // A field's label and its placeholder are deliberately the same words.
      "Search the library",
      "Household password",
      "Enter a server address.",
      // The technical detail shown when the network fails.
      "network error",
    ]);

    const counts = new Map<string, number>();
    const walk = (value: unknown) => {
      if (typeof value === "string") {
        counts.set(value, (counts.get(value) ?? 0) + 1);
        return;
      }
      if (typeof value === "function") return;
      if (value && typeof value === "object") {
        for (const child of Object.values(value)) walk(child);
      }
    };
    walk(copy);

    for (const [value, count] of counts) {
      if (count === 1) continue;
      if (value.length < 12) continue;
      expect(
        ALLOWED_DUPLICATES.has(value),
        `"${value}" appears ${count} times. One phrase, one entry.`,
      ).toBe(true);
    }
  });

  it("says the same thing with the same words everywhere", () => {
    // The one concept, one wording. These three were "Use", "Use this" and
    // "Owned" before the review, and the same action had three labels.
    expect(copy.use).toBe("Use this");
    expect(copy.favourite.inYours).toBe("In your favourites");
    expect(copy.favourite.add).toBe("Add to favourites");
  });

  it("keeps the honesty rule on Discover cards", () => {
    // LIMITATIONS 1.8: these are print records. The label must never imply
    // otherwise, because the card has no play control to contradict it.
    expect(copy.discover.notAnAudiobook).toMatch(/not an audiobook/i);
  });

  it("gives every error a sentence, not a bare status word", () => {
    // `clarify`: an actionable error says what failed, why when known, and how
    // to recover. Before the review these were "Failed", "Incorrect password"
    // and "Request failed (500)" -- a diagnosis with no next step, and one of
    // them with an internal code as the whole message.
    const failures = [
      copy.login.wrongPassword,
      copy.profile.loadFailed(500),
      copy.profile.createFailed(500),
      copy.profile.duplicate,
      copy.settings.unreachable("http://x", "network error"),
      copy.serverSetup.unreachable("http://x", "network error"),
      copy.detail.metadataFailed,
      copy.tagSuite.saveFailed,
      copy.download.removeFailed,
      copy.review.failed,
    ];
    for (const message of failures) {
      // A sentence, not a fragment. The message may end in a parenthetical
      // detail, so this checks that it *contains* a completed clause.
      expect(message, `"${message}" should read as a sentence`).toMatch(/[.!?]/);
      // Long enough to carry a diagnosis and a way out.
      expect(message.length, `"${message}" is too terse to be actionable`).toBeGreaterThan(15);
    }
  });

  it("keeps the internal code out of the primary message", () => {
    // The status is useful to an operator, but it is not the whole sentence.
    expect(copy.profile.loadFailed(500)).toMatch(/^Could not load the profiles/);
    expect(copy.profile.createFailed(500)).toMatch(/^Could not create the profile/);
  });
});
