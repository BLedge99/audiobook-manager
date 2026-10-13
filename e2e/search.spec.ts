import { expect, test, type Page } from "@playwright/test";
import { login, pickAnyProfile } from "./helpers";

/**
 * Spec 22 — typed search.
 *
 * Asserted end-to-end rather than only in the pure module, because the thing
 * most likely to break is the wiring: the query has to reach the URL, survive a
 * reload, and actually narrow the grid.
 */

/** Sign in and land on the library, as every other spec does. */
async function enterApp(page: Page) {
  await page.goto("/");
  await login(page);
  await pickAnyProfile(page);
}

/**
 * Switch to a section tab.
 *
 * Navigate *after* picking a profile: `pickAnyProfile` waits for the "All
 * audiobooks" heading, which only exists on the Library tab, so entering
 * directly on `?tab=browse` times out inside the helper.
 */
async function openTab(page: Page, name: string) {
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name }).click();
}

test("bare text search narrows the library grid", async ({ page }) => {
  await enterApp(page);

  // Learn a title from the DOM so the query cannot pass vacuously.
  const titles = await page.locator("main h3").allInnerTexts();
  const book = titles.map((t) => t.trim()).find((t) => t.length > 8);
  expect(book, "expected at least one book title on the library page").toBeTruthy();

  const uniqueWord = book!.split(/\s+/).find((w) => w.length > 5);
  expect(uniqueWord, "expected a distinctive word in a book title").toBeTruthy();

  const search = page.getByRole("searchbox", { name: /search the library/i });
  await search.fill(uniqueWord!);

  await expect(page.getByRole("status")).toBeVisible();
  await expect(page.getByText(/matching your search/i)).toBeVisible();

  // The result must survive a reload via the URL.
  await page.reload();
  await expect(page.getByRole("searchbox", { name: /search the library/i })).toHaveValue(uniqueWord!);
  await expect(page.getByText(/matching your search/i)).toBeVisible();
});

test("a field:value query is parsed and applied", async ({ page }) => {
  await enterApp(page);
  await openTab(page, "Browse");
  const search = page.getByRole("searchbox", { name: /search the library/i });
  await expect(search).toBeVisible();

  // `author:` with a value nothing can match: the point is that it parses as a
  // facet and reports zero rather than silently ignoring the field syntax.
  await search.fill("author: definitely-not-a-real-author");
  await expect(page.getByRole("status")).toContainText("0 matches");
  await expect(page.getByRole("status")).toContainText("author: definitely-not-a-real-author");

  // The query is in the URL, so it is shareable.
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(
    "author: definitely-not-a-real-author",
  );
});

test("clearing the search restores the full library", async ({ page }) => {
  await enterApp(page);
  const search = page.getByRole("searchbox", { name: /search the library/i });
  const heading = page.getByText(/in your library|matching your search/i);

  await search.fill("zzzz-no-such-book");
  await expect(heading).toContainText("matching your search");

  await page.getByRole("button", { name: /clear search/i }).click();
  await expect(heading).toContainText("in your library");
  await expect(search).toHaveValue("");
});