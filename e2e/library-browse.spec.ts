import { test, expect, type Page } from "@playwright/test";
import { login, pickAnyProfile } from "./helpers";

/**
 * Specs 18-20 — favourites, custom tags, browse and the tag suite.
 *
 * These exercise the surfaces end-to-end against the real stack: the UI, the
 * profile-scoped API and the database. Deliberately absent is an assertion on
 * Discover *content*, because that depends on a live third-party API; what is
 * asserted is that Discover renders an honest state rather than pretending it
 * has results.
 */

async function books(page: Page) {
  const response = await page.request.get("/api/audiobooks");
  return (await response.json()) as { id: number; title: string; author: string }[];
}

/** Sign in and land on the library. */
async function enterApp(page: Page) {
  await page.goto("/");
  await login(page);
  await pickAnyProfile(page);
}

/**
 * The section tabs.
 *
 * Scoped to the nav landmark because the detail modal also contains buttons
 * whose name mentions "favourites", and an unscoped `getByRole` matches both.
 */
function tab(page: Page, name: RegExp) {
  return page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Spec 15b feature 4 — a refresh must never blank the library.
 *
 * The report was "pressed refresh, the app showed nothing in library for around
 * a minute, then repopulated". The cause was that the refetch cleared the rows
 * before the response arrived, so the grid rendered its empty state for exactly
 * as long as the request took.
 *
 * So the test delays the response by two seconds -- long enough that a
 * regression is unmissable -- and asserts the books are still on screen
 * throughout, rather than asserting that they come back eventually.
 */
test.describe("library refresh", () => {
  test("keeps the books on screen while a slow refresh is in flight", async ({ page }) => {
    await enterApp(page);
    const all = await books(page);
    test.skip(all.length === 0, "need a scanned library");
    const book = all[0];

    // Delay only the client-side request the refresh button triggers. The
    // `page.request` helpers above are a separate channel and are unaffected.
    let release: (() => void) | undefined;
    await page.route("**/api/audiobooks*", async (route) => {
      if (!release) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      await route.continue();
    });

    await page.getByRole("button", { name: "Refresh library" }).click();

    // Mid-flight: the book is still there, and something says what is happening.
    await expect(page.getByRole("heading", { name: book.title, exact: true }).first()).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Refreshing" })).toBeVisible();

    release?.();
    await expect(page.getByRole("status").filter({ hasText: "Refreshing" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: book.title, exact: true }).first()).toBeVisible();

    // The regression this file exists for: the empty state appearing at all.
    //
    // Matched on a regex, not the full string, on purpose. The copy is owned
    // by `client/src/copy.ts` and its wording changes; a literal here would
    // quietly stop matching the moment the ellipsis changed, and
    // `toHaveCount(0)` on a string that matches nothing is **vacuously true** --
    // the assertion would pass while checking nothing. A regex keeps the check
    // honest across wording changes.
    await expect(page.getByText(/Loading library/)).toHaveCount(0);
    await expect(page.getByText(/Your library is empty/)).toHaveCount(0);
  });

  test("picking a profile loads progress without leaving the app", async ({ page }) => {
    // LIMITATIONS 1.7: the first fetch happened before a profile existed, so it
    // carried no progress and nothing refetched it -- the dock read as empty
    // until the listener left and came back.
    await page.goto("/");
    await login(page);

    // With no profile stored, the gate must appear; picking one must not.
    await expect(page.getByRole("heading", { name: "Who's listening?" })).toBeVisible();
    await pickAnyProfile(page);
    await expect(page.getByRole("heading", { name: "Your audiobooks" })).toBeVisible();
    await expect(page.getByText(/Loading library/)).toHaveCount(0);
  });
});

/**
 * Spec 15b feature 1 — cover art.
 *
 * The report was that covers randomly reverted to the placeholder, and
 * sometimes rendered as "a solid colour with no placeholder or proper cover".
 *
 * The second symptom is the interesting one, and it is asserted structurally
 * rather than by looking at a screenshot: **no `<img>` may point at the
 * network.** A cover is either a blob URL the browser already holds bytes for, or
 * the bundled placeholder. An image element handed a LAN URL is exactly what
 * painted a half-decoded frame before its `onError` could fire, so the assertion
 * below cannot regress into that case without failing.
 */
test.describe("cover art", () => {
  test("caches covers, then serves them with the network cut off", async ({ page }) => {
    await enterApp(page);
    const all = await books(page);
    test.skip(all.length === 0, "need a scanned library");

    /** Every cover's `src`, classified. */
    const coverSources = () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll("[data-cover] img")).map((img) => img.getAttribute("src") ?? ""),
      );

    // **Step 1: covers must actually load.** This assertion is the one that was
    // missing when this feature shipped: the original test only checked that no
    // image pointed at the network, which is satisfied trivially when *nothing
    // loads at all*. It passed against a build where no cover was ever fetched,
    // because `display: contents` gave the observed wrapper no box and the
    // IntersectionObserver never fired. So: prove the shelf is painted first.
    await expect
      .poll(
        async () => (await coverSources()).filter((src) => src.startsWith("blob:")).length,
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0);

    const warm = await coverSources();
    expect(warm.every((src) => src === "/placeholder-cover.svg" || src.startsWith("blob:"))).toBe(true);

    // **Step 2: cut the network and reload.** Anything still painted came out
    // of the device cache.
    await page.route("**/cover*", (route) => route.abort());
    await page.reload();
    await login(page);
    await expect(page.getByRole("heading", { name: "Your audiobooks" })).toBeVisible();

    await expect
      .poll(
        async () => (await coverSources()).filter((src) => src.startsWith("blob:")).length,
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0);

    const offline = await coverSources();
    expect(offline.every((src) => src === "/placeholder-cover.svg" || src.startsWith("blob:"))).toBe(true);
    expect(offline.filter((src) => src.startsWith("blob:")).length).toBeGreaterThanOrEqual(
      warm.filter((src) => src.startsWith("blob:")).length,
    );
  });
});

test.describe("favourites", () => {
  test("favouriting a book moves it into the Favourites tab and survives a reload", async ({ page }) => {
    await enterApp(page);
    const all = await books(page);
    test.skip(all.length === 0, "need a scanned library");
    const book = all[0];

    await page.getByRole("heading", { name: book.title, exact: true }).first().click();
    await page.getByRole("button", { name: "Add to favourites", exact: true }).click();
    await page.getByLabel("Close details").click();

    await tab(page, /^Favourites/).click();
    await expect(page.getByRole("heading", { name: "Favourites", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: book.title, exact: true }).first()).toBeVisible();

    // A reload must not lose it: it is persisted, not client-side state.
    await page.reload();
    await login(page);
    await tab(page, /^Favourites/).click();
    await expect(page.getByRole("heading", { name: book.title, exact: true }).first()).toBeVisible();
  });

  test("un-favouriting removes the book", async ({ page }) => {
    await enterApp(page);
    const all = await books(page);
    test.skip(all.length === 0, "need a scanned library");
    const book = all[0];

    const profileId = await page.evaluate(() => window.localStorage.getItem("profileId"));
    const headers = { "x-profile-id": profileId as string };
    await page.request.put(`/api/audiobooks/${book.id}/favourite`, { headers });

    await tab(page, /^Favourites/).click();
    await expect(page.getByRole("heading", { name: book.title, exact: true }).first()).toBeVisible();

    await page.getByRole("heading", { name: book.title, exact: true }).first().click();
    await page.getByRole("button", { name: "In your favourites", exact: true }).click();
    await page.getByLabel("Close details").click();

    await expect(page.getByRole("heading", { name: book.title, exact: true })).toHaveCount(0);
  });

  test("favouriting twice is idempotent, not an error", async ({ page }) => {
    await enterApp(page);
    const all = await books(page);
    test.skip(all.length === 0, "need a scanned library");
    const profileId = await page.evaluate(() => window.localStorage.getItem("profileId"));
    const headers = { "x-profile-id": profileId as string };

    const first = await page.request.put(`/api/audiobooks/${all[0].id}/favourite`, { headers });
    const second = await page.request.put(`/api/audiobooks/${all[0].id}/favourite`, { headers });

    expect(first.ok()).toBeTruthy();
    expect(second.ok()).toBeTruthy();
    expect(await second.json()).toMatchObject({ favourited: true, alreadyExisted: true });
  });
});

test.describe("custom tags", () => {
  test("a tag can be created, appears in the list, and is merged away", async ({ page }) => {
    await enterApp(page);
    await tab(page, /^Browse/).click();
    await expect(page.getByRole("heading", { name: "Browse", exact: true })).toBeVisible();

    const unique = `e2e${Date.now().toString(36)}`;
    const create = page.getByLabel("New tag name");
    await create.fill(unique);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    // The list refetches from the server, so this asserts persistence.
    await expect(page.getByRole("listitem").filter({ hasText: new RegExp(`^${unique}\\b`) })).toHaveCount(1);

    // A second tag, so there is something to merge into.
    const survivor = `${unique}keep`;
    await create.fill(survivor);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("listitem").filter({ hasText: new RegExp(`^${survivor}\\b`) })).toHaveCount(1);

    // Scope to the labelled merge controls. `page.locator("select")` would also
    // match the profile combobox, which appears earlier in the DOM.
    const mergeFrom = page.getByLabel("Tag to merge", { exact: true });
    const mergeInto = page.getByLabel("Merge into tag", { exact: true });
    await expect(mergeFrom).toBeVisible();
    await mergeFrom.selectOption({ label: unique });
    await mergeInto.selectOption({ label: survivor });
    await page.getByRole("button", { name: "Merge", exact: true }).click();

    await expect(page.getByText(/books? moved/)).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: new RegExp(`^${unique}\\b`) })).toHaveCount(0);

    // Clean up, or the tag list grows by one on every run of this spec.
    await page.getByRole("button", { name: `Delete ${survivor}` }).click();
    await expect(page.getByRole("listitem").filter({ hasText: new RegExp(`^${survivor}\\b`) })).toHaveCount(0);
  });

  test("a reserved tag name is rejected with a message, not a silent failure", async ({ page }) => {
    await enterApp(page);
    await tab(page, /^Browse/).click();

    await page.getByLabel("New tag name").fill("discover");
    await page.getByRole("button", { name: "Add", exact: true }).click();

    await expect(page.getByText(/Tag name rejected/)).toBeVisible();
  });
});

test.describe("browse", () => {
  test("filters are reflected in the URL and restored from it", async ({ page }) => {
    await enterApp(page);
    const all = await books(page);
    test.skip(all.length === 0, "need a scanned library");

    await tab(page, /^Browse/).click();
    await expect(page.getByRole("heading", { name: "Browse", exact: true })).toBeVisible();

    const authorGroup = page.getByRole("group", { name: "Filter by author" });
    await expect(authorGroup).toBeVisible();
    const chip = authorGroup.getByRole("button", { name: new RegExp(`^${escapeRegExp(all[0].author)}`) }).first();
    await expect(chip).toBeVisible();
    await chip.click();

    // Check the URL first: it proves the click registered before asserting on
    // anything rendered, which makes a failure diagnosable.
    await expect
      .poll(() => {
        const raw = new URL(page.url()).searchParams.get("f");
        // URLSearchParams encodes spaces as "+", which decodeURIComponent
        // leaves alone.
        return raw ? decodeURIComponent(raw.replace(/\+/g, " ")) : null;
      })
      .toContain(all[0].author);
    await expect(page.getByRole("heading", { name: "Filtered results" })).toBeVisible();

    // A reload must restore the whole view from the URL alone: both the tab
    // and the filter. Restoring only the filter lands on Library and looks
    // like the filter was lost.
    const shared = page.url();
    await page.goto(shared);
    await login(page);
    await expect(page.getByRole("heading", { name: "Filtered results" })).toBeVisible();
  });

  test("clearing filters returns to the shelves", async ({ page }) => {
    await enterApp(page);
    const all = await books(page);
    test.skip(all.length === 0, "need a scanned library");

    await tab(page, /^Browse/).click();
    const authorGroup = page.getByRole("group", { name: "Filter by author" });
    await authorGroup.getByRole("button", { name: new RegExp(`^${escapeRegExp(all[0].author)}`) }).first().click();
    await expect(page.getByRole("heading", { name: "Filtered results" })).toBeVisible();

    await page.getByRole("button", { name: /^Clear \d/ }).click();
    await expect(page.getByRole("heading", { name: "Filtered results" })).toHaveCount(0);
  });
});

test.describe("server library", () => {
  test("lists every book on the server and marks the ones in the profile", async ({ page }) => {
    // Spec 27. The tab answers a different question from the Library tab:
    // "what else is there to listen to?"
    await enterApp(page);
    await tab(page, /^All books/).click();

    // The heading says why the listener is here and what they can do, in their
    // own terms -- not what the system is doing.
    await expect(page.getByRole("heading", { name: "Select books to add to your library" })).toBeVisible();
    await expect(page.getByText(/Every audiobook the household has/)).toBeVisible();

    // The server's shelf and the profile's shelf are the same books here --
    // the seeded profiles follow the server library -- so the count line is
    // what proves the tab read the server, not the profile.
    await expect(page.getByText(/\d+ of \d+ in your library/)).toBeVisible();
    await expect(page.getByText("All audiobooks")).toBeVisible();
  });

  test("a book can be added to and removed from the profile in the tab", async ({ page }) => {
    // The whole membership flow, in the surface it lives in: a fresh profile
    // starts with nothing, adds a book from the server shelf, and takes it
    // back out again -- which is the half that was missing. A list that shows
    // which books you have has to let you change that, or it is a dead end.
    await enterApp(page);

    const created = await page.request.post("/api/profiles", {
      data: { name: `E2E Membership ${Date.now().toString(36)}` },
    });
    const profile = await created.json();

    // Put the fresh profile in the app. A fresh profile starts with an empty
    // library, which is the state this test needs.
    await page.evaluate((id) => window.localStorage.setItem("profileId", id), String(profile.id));
    await page.reload();
    await expect(page.getByRole("heading", { name: /your audiobooks/i }).first()).toBeVisible();

    await tab(page, /^All books/).click();
    await expect(page.getByText(/\d+ of \d+ in your library/)).toBeVisible({ timeout: 30_000 });

    // Nothing is in this profile's library yet, so the first row offers Add.
    const add = page.getByRole("button", { name: "Add" }).first();
    await expect(add).toBeVisible();
    const row = page.locator("li").filter({ has: add }).first();
    const title = (await row.locator("span").first().textContent())?.trim() ?? "";

    await add.click();
    // Now it is in the library, and the row offers to take it back out.
    await expect(page.getByRole("button", { name: /remove from my library/i }).first()).toBeVisible();

    // And it is in the Library tab too.
    await tab(page, /^Library/).click();
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 30_000 });

    // Back to the server shelf, and take it out again.
    await tab(page, /^All books/).click();
    await expect(page.getByText(/\d+ of \d+ in your library/)).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /remove from my library/i }).first().click();
    await expect(page.getByRole("button", { name: "Add" }).first()).toBeVisible({ timeout: 30_000 });

    // Clean up so the next run starts from a known state.
    await page.request.delete(`/api/profiles/${profile.id}`);
  });

  test("a book can be added to the profile from the server shelf", async ({ page }) => {
    // The whole point of the tab. A profile that does not follow the server
    // library starts empty, and this is how it gets something.
    await enterApp(page);

    // A fresh profile starts with an empty library, which is the state this
    // test needs.
    const created = await page.request.post("/api/profiles", {
      data: { name: `E2E Membership ${Date.now().toString(36)}` },
    });
    const profile = await created.json();
    const headers = { "x-profile-id": String(profile.id) };

    const serverBooks = await (
      await page.request.get("/api/server-library", { headers })
    ).json();
    expect(serverBooks.length).toBeGreaterThan(0);
    expect(serverBooks.every((book: { inLibrary: boolean }) => book.inLibrary === false)).toBe(true);

    // Put the profile in the app, so the tab reads it.
    //
    // Set directly rather than through the profile gate: the session is
    // already authenticated by this point, so the gate is never shown and
    // there would be no button to click.
    await page.evaluate((id) => window.localStorage.setItem("profileId", id), String(profile.id));
    await page.reload();
    await expect(page.getByRole("heading", { name: "Your audiobooks" })).toBeVisible();

    await tab(page, /^All books/).click();
    await expect(page.getByRole("heading", { name: "Select books to add to your library" })).toBeVisible();

    // The first book is not in this profile's library, so it offers an Add.
    const add = page.getByRole("button", { name: "Add" }).first();
    await expect(add).toBeVisible();
    await add.click();

    // And the membership took: the server agrees.
    await expect
      .poll(async () => {
        const after = await (await page.request.get("/api/server-library", { headers })).json();
        return after.filter((book: { inLibrary: boolean }) => book.inLibrary).length;
      }, { timeout: 15_000 })
      .toBe(1);

    // Clean up so the next run starts from a known state.
    await page.request.delete(`/api/profiles/${profile.id}`);
  });
});

test.describe("discover", () => {
  test("Discover renders and states its own limits instead of faking results", async ({ page }) => {
    await enterApp(page);
    await tab(page, /^Discover/).click();
    await expect(page.getByRole("heading", { name: "Discover", exact: true })).toBeVisible();
    // Wishlist is always present, even when empty.
    await expect(page.getByRole("heading", { name: "Wishlist", exact: true })).toBeVisible();
    await expect(page.getByText(/Books you do not have yet/)).toBeVisible();
  });

  test("favouriting books actually produces suggestions", async ({ page }) => {
    // This test exists because of a bug that every other Discover test happily
    // passed. Discover had *never once* returned a result -- Audnexus has no free
    // title search and LibriVox matches titles exactly, so feeding it genre
    // words always yielded an empty pool. The suite asserted "the tab renders and
    // admits it has nothing", which an eternally broken feature satisfies
    // perfectly.
    //
    // So assert the thing that was actually broken: real suggestions, derived
    // from real favourites.
    await enterApp(page);
    const headers = { "x-profile-id": (await page.evaluate(() => window.localStorage.getItem("profileId"))) as string };

    const library = await (await page.request.get("/api/audiobooks", { headers })).json();
    expect(library.length).toBeGreaterThan(0);

    // Favourite enough distinct books that the seed has genres to work with.
    for (const book of library.slice(0, 3)) {
      await page.request.put(`/api/audiobooks/${book.id}/favourite`, { headers });
    }

    await page.reload();
    await login(page);
    await tab(page, /^Discover/).click();

    const cards = page.getByRole("article").filter({ hasText: /Because (it shares|you like)/ });
    await expect(cards.first()).toBeVisible({ timeout: 60_000 });

    // Each card must give a reason, and must not pretend to be playable.
    await expect(cards.first().getByText(/Because /)).toBeVisible();
    await expect(cards.first().getByText(/not an audiobook yet/i)).toBeVisible();

    // And it must never suggest something already in the library.
    const owned = new Set(library.map((b: { title: string }) => b.title.toLowerCase()));
    const titles = await cards.allTextContents();
    for (const title of titles) {
      for (const ownedTitle of owned) {
        if (ownedTitle && title.toLowerCase().includes(ownedTitle)) {
          throw new Error(`Discover suggested an owned title: ${ownedTitle}`);
        }
      }
    }
  });

  test("shows five suggestions at a time and pages with a button", async ({ page }) => {
    // Spec 15b feature 3. The tester asked for "top 5 at a time, then allow a
    // 'load more' button", and complained that results arrived "at random".
    await enterApp(page);
    const headers = { "x-profile-id": (await page.evaluate(() => window.localStorage.getItem("profileId"))) as string };
    const library = await (await page.request.get("/api/audiobooks", { headers })).json();
    expect(library.length).toBeGreaterThan(0);
    for (const book of library.slice(0, 3)) {
      await page.request.put(`/api/audiobooks/${book.id}/favourite`, { headers });
    }

    await page.reload();
    await login(page);
    await tab(page, /^Discover/).click();

    const cards = page.getByRole("article").filter({ hasText: /Because / });
    await expect(cards.first()).toBeVisible({ timeout: 60_000 });

    const more = page.getByRole("button", { name: "Show 5 more" });
    const shown = await cards.count();
    // Never more than one page at a time.
    expect(shown).toBeLessThanOrEqual(5);

    if (await more.isVisible()) {
      // Exactly one page shown, and another one available behind the button.
      expect(shown).toBe(5);
      await more.click();
      // "Load more" appends five and never empties what was already there.
      await expect(cards).toHaveCount(10, { timeout: 60_000 });
    } else {
      // No button is honest: the pool ran out. But then everything is shown.
      expect(shown).toBe(await page.getByRole("article").filter({ hasText: /Because / }).count());
    }
  });

  test("wishlist items are never presented as playable", async ({ page }) => {
    await enterApp(page);
    await tab(page, /^Discover/).click();

    const profileId = await page.evaluate(() => window.localStorage.getItem("profileId"));
    const headers = { "x-profile-id": profileId as string };
    const created = await page.request.post("/api/wishlist", {
      headers,
      data: {
        title: "A Book You Do Not Own",
        author: "Nobody",
        provider: "audnexus",
        providerKey: `e2e${Date.now().toString(36)}`,
      },
    });
    expect(created.ok()).toBeTruthy();
    // Structural guarantee from spec 19, asserted at the API boundary.
    expect((await created.json()).playable).toBe(false);

    await page.reload();
    await login(page);
    await tab(page, /^Discover/).click();
    // Earlier runs of this spec leave rows with the same title behind, so
    // assert on the specific row rather than the first text match.
    const row = page.getByRole("article").filter({ hasText: "A Book You Do Not Own" }).last();
    await expect(row).toBeVisible();
    await expect(row.getByText("Not in your library yet")).toBeVisible();
  });
});

test.describe("tag suite", () => {
  /**
   * Editing a field creates a *permanent* override row that blocks the scanner
   * from ever rewriting that field again. So this test must restore the book
   * exactly as it found it -- an earlier version of this test left a real
   * library book renamed to "Corrected mv58pt9t" with nine bogus overrides.
   */
  test("editing the tag suite persists and the field is marked as yours", async ({ page }) => {
    await enterApp(page);
    const all = await books(page);
    test.skip(all.length === 0, "need a scanned library");
    const book = all[0];

    const profileId = await page.evaluate(() => window.localStorage.getItem("profileId"));
    const headers = { "x-profile-id": profileId as string };
    const restore = async () => {
      // Put the original title back first, then drop every override.
      // Reset alone only removes the *lock* -- the value the test wrote would
      // otherwise stay in the library until the next scan, which is how an
      // earlier version of this test left a book named "Corrected mv58pt9t".
      await page.request.put(`/api/audiobooks/${book.id}/tags`, {
        headers,
        data: { title: book.title },
      });
      await page.request.post(`/api/audiobooks/${book.id}/metadata/reset`, { headers });
    };

    try {
      await page.getByRole("heading", { name: book.title, exact: true }).first().click();

      // Spec 15b feature 5 moved the metadata behind a disclosure, so the panel
      // has to be opened before it exists. The assertions below are unchanged;
      // only the two lines that reach it are new.
      await page.getByRole("button", { name: "Book details" }).click();
      const details = page.getByRole("region", { name: "Details" });
      await expect(details).toBeVisible();

      await details.getByRole("button", { name: "Edit" }).click();
      const corrected = `E2E title ${Date.now().toString(36)}`;
      await details.getByLabel("Title", { exact: true }).fill(corrected);
      await details.getByRole("button", { name: "Save" }).click();

      await expect(details.getByText(/now win over anything the providers suggest/)).toBeVisible();
      // Provenance: the Reset control only appears once a field is overridden.
      await expect(details.getByRole("button", { name: "Reset" })).toBeVisible();

      await page.getByLabel("Close details").click();

      // Survives a reload because it is an override row, not client state.
      await page.reload();
      await login(page);
      await expect(page.getByRole("heading", { name: corrected, exact: true }).first()).toBeVisible();

      // Only the edited field may be locked. An earlier version saved the whole
      // form, which pinned publisher/year/series/description too.
      const suite = await (await page.request.get(`/api/audiobooks/${book.id}/tags`, { headers })).json();
      expect((suite as { overriddenFields: string[] }).overriddenFields).toEqual(["title"]);
    } finally {
      await restore();
    }
  });
});