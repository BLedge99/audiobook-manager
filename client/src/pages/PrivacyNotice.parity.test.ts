/**
 * Spec 42, phase 4 — the two privacy notices must not drift.
 *
 * The server serves the canonical standalone document at GET /privacy; the
 * in-app route renders the same notice for the jurisdictions where the
 * service worker hands the browser the app instead of that document. Two
 * copies of a legal text will drift without a pin. This test is the pin:
 * every section anchor in the server document must exist in the in-app
 * component, and the load-bearing commitments must match word for word.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const serverSource = readFileSync(path.resolve(__dirname, "../../../server/src/routes/static.ts"), "utf8");
const clientSource = readFileSync(path.resolve(__dirname, "PrivacyNotice.tsx"), "utf8");

describe("privacy notice parity", () => {
  const sectionIds = [...serverSource.matchAll(/<h2 id="([^"]+)"/g)].map((match) => match[1]);

  it("the server document is structured as sections", () => {
    expect(sectionIds.length).toBeGreaterThanOrEqual(10);
  });

  it.each(sectionIds)("the in-app notice carries the section #%s", (id) => {
    expect(clientSource).toContain(`id="${id}"`);
  });

  it.each([
    "We do not share your personal data with any third party.",
    "(Art. 6(1)(b))",
    "privacy@example.org",
  ])("the in-app notice preserves: %s", (text) => {
    // JSX folds whitespace differently from HTML, so compare with whitespace
    // collapsed on both sides.
    const collapse = (s: string) => s.replace(/\s+/g, " ");
    expect(collapse(serverSource)).toContain(collapse(text));
    expect(collapse(clientSource)).toContain(collapse(text));
  });
});
