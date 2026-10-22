import { describe, it, expect } from "vitest";
import { copy, plural, verbFor } from "./copy";

/**
 * Spec 15b feature 7 — the copy table.
 *
 * The copy table is the one file every screen's wording comes from, so it is
 * the one file where a typo is invisible until someone uses the app. These
 * tests are deliberately about the *mechanics* rather than the wording,
 * because the wording is a judgement call and the mechanics are not.
 *
 * The failure that prompted this file: `plural(count, "match")` produced
 * "matchs", and the only thing that caught it was an unrelated component test
 * happening to assert the rendered string. The helper is now tested directly.
 */

describe("plural", () => {
  it("uses the singular for one", () => {
    expect(plural(1, "book")).toBe("1 book");
  });

  it("uses the plural for more than one", () => {
    expect(plural(2, "book")).toBe("2 books");
    expect(plural(0, "book")).toBe("0 books");
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

/** Every string in the table, with the path it was found at. */
function stringsIn(value: unknown, path: string, out: [string, string][] = []): [string, string][] {
  if (typeof value === "string") {
    out.push([path, value]);
    return out;
  }
  if (typeof value === "function") return out;
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      stringsIn(child, `${path}.${key}`, out);
    }
  }
  return out;
}

/** The listener-facing copy: everything except the operator tier. */
function listenerValue(): object {
  const { operator: _operator, ...listener } = copy;
  return listener;
}

function listenerStrings(): [string, string][] {
  return stringsIn(listenerValue(), "copy");
}

/**
 * The system's own vocabulary, which must not reach a listener.
 *
 * This list mirrors the product words in `scripts/copy.config.json`, which is
 * where the checker (`npm run check:copy`) reads them. The config also lists,
 * in `ignoreKeys`, the strings that still contain one of these words -- the
 * burn-down worklist from the copy review. Each key moves off that list and
 * onto this one as its string is rewritten.
 */
const BANNED_WORDS = [
  "metadata",
  "enrichment",
  "enriched",
  "taxonomy",
  "seeded",
  "seeding",
  "cache",
  "cached",
  "endpoint",
  "payload",
  "schema",
  "idempotent",
  "normalise",
  "user library",
  "home server",
];

/**
 * Every function-valued entry, rendered with sample arguments, so the checks
 * below see the message a listener actually reads instead of skipping it.
 *
 * A function is the table's shape for "this message has a value in it". These
 * entries used to be invisible to this suite *and* to the checker, which made
 * the ~60 messages carrying a number or a name the least-checked strings in the
 * file. The sample arguments only exist to make the template literal produce a
 * string; nothing here asserts the wording, only the *mechanics*.
 */
function dynamicStrings(value: unknown, path: string, out: [string, string][] = []): [string, string][] {
  if (typeof value === "function") {
    const fn = value as (...args: unknown[]) => unknown;
    const args = Array.from({ length: fn.length }, () => "Sample");
    let rendered: unknown;
    try {
      rendered = fn(...args);
    } catch (err) {
      throw new Error(`${path} threw on sample arguments: ${String(err)}`);
    }
    if (typeof rendered === "string") out.push([path, rendered]);
    return out;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      dynamicStrings(child, `${path}.${key}`, out);
    }
  }
  return out;
}

/** The path of every function-valued entry in the table. */
function functionPaths(value: unknown, path: string, out: string[] = []): string[] {
  if (typeof value === "function") {
    out.push(path);
    return out;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      functionPaths(child, `${path}.${key}`, out);
    }
  }
  return out;
}

/**
 * Every message with a value in it -- the entries that will become ICU
 * MessageFormat messages when the app is internationalised.
 *
 * They are template literals today, so English words and numbers are spliced
 * into a fixed order that a translator cannot change. That is a known,
 * deliberate gap (spec 15b feature 7), not an oversight -- and this list is
 * how it stays known: the assertion below fails if a function-valued entry is
 * added or removed without updating the list. Converting one to ICU means
 * deleting its line here.
 */
const ICU_PENDING = [
  "copy.narratedBy",
  "copy.narratedByCount",
  "copy.shell.libraryCount",
  "copy.shell.offlineBanner",
  "copy.library.countInLibrary",
  "copy.library.countMatching",
  "copy.continueListening.count",
  "copy.continueListening.more",
  "copy.card.tracks",
  "copy.card.findMoreLike",
  "copy.favourite.remove",
  "copy.favourite.addNamed",
  "copy.filters.clearCount",
  "copy.filters.groupLabel",
  "copy.search.matches",
  "copy.discover.showing",
  "copy.discover.removeFromWishlist",
  "copy.discover.markOwned",
  "copy.favourites.count",
  "copy.serverLibrary.heldCount",
  "copy.serverLibrary.offlineCount",
  "copy.download.downloading",
  "copy.download.onThisDevice",
  "copy.download.progressLabel",
  "copy.download.removedWithErrors",
  "copy.player.backSeconds",
  "copy.player.forwardSeconds",
  "copy.player.sleepMinutes",
  "copy.player.trackFallback",
  "copy.player.intoThis",
  "copy.profile.loadFailed",
  "copy.profile.createFailed",
  "copy.profile.createUnreachable",
  "copy.profile.unreachable",
  "copy.position.chapterTitle",
  "copy.position.heading",
  "copy.position.minutesLeft",
  "copy.position.hoursMinutesLeft",
  "copy.position.hoursLeft",
  "copy.series.positionInSeries",
  "copy.errors.requestFailed",
  "copy.errors.downloadRejected",
  "copy.errors.trackFailed",
  "copy.errors.downloadIncomplete",
  "copy.errors.noTracks",
  "copy.errors.sizeUnreadable",
  "copy.operator.libraryFolders.scanFolder",
  "copy.operator.libraryFolders.removeFolder",
  "copy.operator.enrichment.notice",
  "copy.operator.review.intro",
  "copy.operator.review.checking",
  "copy.operator.review.matchPercent",
  "copy.operator.review.currentlyShownAs",
  "copy.operator.review.series",
  "copy.operator.tags.renameLabel",
  "copy.operator.tags.deleteLabel",
  "copy.operator.tags.merged",
  "copy.operator.settings.unreachable",
  "copy.operator.settings.booksDownloaded",
  "copy.operator.settings.coversCached",
  "copy.operator.serverSetup.unreachable",
].sort();

describe("the copy table", () => {
  it("has no empty strings", () => {
    // An empty string renders as an invisible gap, and a gap is worse than a
    // wrong word because nothing announces it.
    for (const [path, value] of stringsIn(copy, "copy")) {
      expect(value, `${path} is empty`).not.toBe("");
    }
  });

  it("uses one ellipsis character everywhere, never three dots", () => {
    for (const [path, value] of stringsIn(copy, "copy")) {
      expect(value, `${path} uses "..." instead of "…"`).not.toMatch(/\.\.\./);
    }
  });

  it("has no exclamation marks", () => {
    // A confirmation is a fact, not an event.
    for (const [path, value] of stringsIn(copy, "copy")) {
      expect(value, `${path} has an exclamation mark`).not.toContain("!");
    }
  });

  /**
   * The rule that matters most: **write for the listener**.
   *
   * A heading, an explanation or a hint must say why the listener is there and
   * what they can do, in their terms -- not what the system is doing. The
   * failure mode is a heading like "Home server library -- select books to add
   * to user library", which is a perfectly good comment to a developer and
   * useless to a person.
   *
   * The words below are the system's own vocabulary. They belong in
   * `copy.operator`, where the person maintaining the server reads them, and
   * they do not belong in the copy a listener reads on an everyday screen.
   *
   * "shelf" is deliberately **not** on this list. It is the app's own
   * metaphor -- the visual world is a capsule vending machine, and a vending
   * machine has shelves -- so a listener who sees one on screen already knows
   * what it means. The rule is about the *system's* words, not about the
   * *brand's*.
   */
  it("keeps the system's own vocabulary out of the listener's copy", () => {
    for (const [path, value] of listenerStrings()) {
      const lower = value.toLowerCase();
      for (const word of BANNED_WORDS) {
        expect(lower, `${path} says "${word}", which is the system's word, not the listener's`).not.toContain(word);
      }
    }
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
    expect("use" in copy.operator.review).toBe(false);
    expect("findMoreLikeThis" in copy.detail).toBe(false);
    expect("findMoreLikeThis" in copy.card).toBe(false);
    expect("addToFavourites" in copy.detail).toBe(false);
    expect("inYourFavourites" in copy.detail).toBe(false);
    expect("unknownAuthor" in copy.discover).toBe(false);
    expect("unknownAuthor" in copy.operator.review).toBe(false);
    expect("narratedBy" in copy.detail).toBe(false);
    expect("narratedBy" in copy.operator.review).toBe(false);
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
    for (const [value] of stringsIn(copy, "copy")) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }

    for (const [value, count] of counts) {
      if (count === 1) continue;
      if (value.length < 12) continue;
      expect(
        ALLOWED_DUPLICATES.has(value),
        `"${value}" appears ${count} times. One phrase, one entry.`,
      ).toBe(true);
    }
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
      copy.operator.settings.unreachable("http://x", "network error"),
      copy.operator.serverSetup.unreachable("http://x", "network error"),
      copy.operator.metadata.failed,
      copy.operator.tagSuite.saveFailed,
      copy.download.removeFailed,
      copy.operator.review.failed,
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

describe("the dynamic copy", () => {
  /**
   * The gate that keeps the ICU gap visible rather than forgotten.
   *
   * If this fails, either the entry belongs in `ICU_PENDING` (it is a message
   * with a value in it) or it should be a plain string. A function-valued entry
   * is a message with a placeholder, and a placeholder is exactly what has to
   * become an ICU message when the app is translated.
   */
  it("labels every function-valued message as pending ICU", () => {
    expect(functionPaths(copy, "copy").sort()).toEqual(ICU_PENDING);
  });

  it("keeps the system's own vocabulary out of the listener's dynamic copy", () => {
    // The static check above cannot see inside a template literal, so the
    // messages carrying a number or a name get their own pass. This is the
    // check that would have caught "4 books in user library" on a heading.
    for (const [path, value] of dynamicStrings(listenerValue(), "copy")) {
      const lower = value.toLowerCase();
      for (const word of BANNED_WORDS) {
        expect(lower, `${path} says "${word}", which is the system's word, not the listener's`).not.toContain(word);
      }
    }
  });

  it("holds dynamic messages to the same mechanics as static ones", () => {
    for (const [path, value] of dynamicStrings(copy, "copy")) {
      expect(value, `${path} is empty`).not.toBe("");
      expect(value, `${path} uses "..." instead of "…"`).not.toMatch(/\.\.\./);
      expect(value, `${path} has an exclamation mark`).not.toContain("!");
    }
  });
});
