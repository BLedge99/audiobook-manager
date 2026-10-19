import { test, expect } from "@playwright/test";
import { login, pickAnyProfile } from "./helpers";

/**
 * No horizontal scrolling, at any phone width.
 *
 * ## Why this exists
 *
 * On the Android WebView the app rendered roughly three screen-phones wide and
 * had to be dragged sideways to be usable. That is an objective, checkable
 * defect -- `documentElement.scrollWidth > clientWidth` -- and it went unnoticed
 * because every existing spec ran at desktop width, where the layout reflows and
 * the bug does not exist.
 *
 * The fix was the detail modal's unconstrained `w-full` cover, but the guard is
 * deliberately generic: it reports *which* elements overflow, so the next one is
 * diagnosable from a CI failure rather than from a screenshot someone squints at.
 */

/** Common phone widths, narrowest first. */
const PHONE_WIDTHS = [320, 360, 390, 412];

/** Walk the DOM and report anything that makes the document scroll sideways. */
async function findOverflow(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const viewport = doc.clientWidth;

    const describe = (el: Element) => {
      const cls = (el.getAttribute("class") || "").trim().split(/\s+/).slice(0, 6).join(".");
      const id = el.getAttribute("id") || "";
      return el.tagName.toLowerCase() + (id ? `#${id}` : "") + (cls ? `.${cls}` : "");
    };

    const offenders: Array<{ el: string; width: number; right: number; kind: string }> = [];
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const rect = el.getBoundingClientRect();
      const boxWide = rect.width > viewport + 1 || rect.right > viewport + 1;
      // An element can be narrow and still force the document wider, because
      // its *content* overflows it (a long unbreakable string, a fixed-width
      // child, or a nowrap flex row). Checking only the box width missed the
      // real culprit on the first run, so check both.
      const contentWide = el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0;
      if (!boxWide && !contentWide) continue;
      if (rect.width === 0 && rect.height === 0 && !contentWide) continue;
      offenders.push({
        el: describe(el),
        width: Math.round(rect.width),
        right: Math.round(rect.right),
        kind: boxWide ? "box" : "content",
      });
    }

    return {
      viewport,
      scrollWidth: doc.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      offenders: offenders.sort((a, b) => b.width - a.width).slice(0, 8),
    };
  });
}

test.describe("phone layout", () => {
  for (const width of PHONE_WIDTHS) {
    test(`library does not scroll sideways at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 780 });
      await page.goto("/");
      await login(page);
      await pickAnyProfile(page);
      await expect(page.getByRole("heading", { name: /all audiobooks/i }).first()).toBeVisible();

      const result = await findOverflow(page);
      expect(
        result.scrollWidth,
        `horizontal overflow at ${width}px: document is ${result.scrollWidth}px wide. ` +
          `Widest offenders: ${JSON.stringify(result.offenders, null, 2)}`,
      ).toBeLessThanOrEqual(result.viewport + 1);
    });
  }

  test("opening a book shows the player without scrolling", async ({ page }) => {
    // Spec 15b feature 5. The tester asked for this directly: "the player for
    // books should be at the top rather than below a load of info like tags
    // etc, the most common reason for opening a book is to play it". The detail
    // page used to end with the player, under tags, series and the description.
    //
    // Asserted as geometry rather than presence, because "the player exists"
    // was true before this change too -- it was simply below the fold.
    const height = 780;
    await page.setViewportSize({ width: 390, height });
    await page.goto("/");
    await login(page);
    await pickAnyProfile(page);
    await expect(page.getByRole("heading", { name: /all audiobooks/i }).first()).toBeVisible();

    await page.locator("[data-book-id], article, button").filter({ hasText: /tracks/i }).first().click();
    const dialog = page.locator("div.fixed.inset-0 > article").first();
    await expect(dialog).toBeVisible();

    const player = page.getByLabel("Audiobook player");
    await expect(player).toBeVisible();
    const box = await player.boundingBox();
    expect(box, "the player has no layout box").not.toBeNull();
    // Inside the first viewport, so nobody has to scroll to press play.
    expect(box!.y, `player starts at y=${box!.y}, below the ${height}px viewport`).toBeLessThan(height);

    // And the metadata that used to sit above it is not on screen at all.
    await expect(page.getByRole("region", { name: "Details" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Book details" })).toBeVisible();
  });

  test("book detail modal does not scroll sideways at 360px", async ({ page }) => {
    // The regression lived here: the modal stacks below `md`, so its cover was
    // `w-full` at `aspect-[2/3]` and blew the layout out to several screen widths.
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/");
    await login(page);
      await pickAnyProfile(page);
    await expect(page.getByRole("heading", { name: /all audiobooks/i }).first()).toBeVisible();

    const firstCard = page.locator("[data-book-id], article, button").filter({ hasText: /tracks/i }).first();
    await firstCard.click();

    // `div.fixed.inset-0 > article`, not `getByRole("article").first()`: book cards
    // are also <article>, so `.first()` matched a card in the grid and measured
    // the wrong element -- which is why this test kept reporting ~600px long
    // after the dialog itself was already fixed.
    const dialog = page.locator("div.fixed.inset-0 > article").first();
    await expect(dialog).toBeVisible();

    const result = await findOverflow(page);
    expect(
      result.scrollWidth,
      `detail modal overflows at 360px: document is ${result.scrollWidth}px wide. ` +
        `Widest offenders: ${JSON.stringify(result.offenders, null, 2)}`,
    ).toBeLessThanOrEqual(result.viewport + 1);

    // The document check alone gave a false green here. The dialog is only as
    // wide as the viewport, so the page never scrolled -- but the dialog's own
    // `overflow-auto` scrolled sideways instead, because a CSS Grid item
    // defaults to `min-width: auto` and blew its column past the viewport. Assert
    // the dialog does not scroll internally, or this bug hides again.
    const dialogScroll = await dialog.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(
      dialogScroll.scrollWidth,
      `detail dialog scrolls sideways: content is ${dialogScroll.scrollWidth}px inside a ` +
        `${dialogScroll.clientWidth}px dialog. A grid item is probably missing min-w-0.`,
    ).toBeLessThanOrEqual(dialogScroll.clientWidth + 1);
  });
});