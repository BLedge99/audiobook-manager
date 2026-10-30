import { test, expect, type Page } from "@playwright/test";
import { ensureAuthed, login, pickAnyProfile } from "./helpers";

/**
 * Spec 14: the interface must show where the listener is, not just a scrubber.
 *
 * Asserted against the rendered text and the DOM geometry of the decoration,
 * because those are the only things a listener actually sees.
 */

type Book = { id: number; title: string; duration: number; tracks: { id: number; trackNumber: number; duration: number }[]; chapters?: string | null };

async function books(page: Page): Promise<Book[]> {
  await ensureAuthed(page);
  return (await (await page.request.get("/api/audiobooks")).json()) as Book[];
}

function segmentCount(book: Book): number {
  if (book.tracks.length) return book.tracks.length;
  try {
    const chapters = JSON.parse(book.chapters || "[]");
    return Array.isArray(chapters) ? chapters.length : 0;
  } catch {
    return 0;
  }
}

/** Absolute start offsets of each segment, matching `lib/position.ts`. */
function segmentOffsets(book: Book): number[] {
  if (book.tracks.length) {
    let offset = 0;
    return [...book.tracks]
      .sort((a, b) => a.trackNumber - b.trackNumber)
      .map((track) => {
        const at = offset;
        offset += track.duration;
        return at;
      });
  }
  try {
    const chapters = JSON.parse(book.chapters || "[]");
    if (!Array.isArray(chapters)) return [];
    return chapters
      .map((chapter: { start?: number }) => (Number.isFinite(chapter.start) ? chapter.start : 0))
      .sort((a: number, b: number) => a - b);
  } catch {
    return [];
  }
}

/** Seek via the native input, the way a user drags the slider. */
async function seekTo(page: Page, seconds: number) {
  const slider = page.getByLabel("Audiobook progress");
  await slider.evaluate((element, target) => {
    const input = element as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setValue?.call(input, String(target));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, seconds);
}

test("the player shows chapter, position in chapter and overall progress", async ({ page }) => {
  await page.goto("/");
  await login(page);
  await pickAnyProfile(page);
  const profileId = await page.evaluate(() => window.localStorage.getItem("profileId"));
  const headers = { "x-profile-id": profileId as string };

  const all = await books(page);
  const offsets = new Map<number, number[]>();
  // Needs more than one segment for the chapter readout to mean anything, and
  // enough room after the second segment's start to seek 90s into it.
  const book = all.find((candidate) => {
    const starts = segmentOffsets(candidate);
    if (starts.length < 2 || candidate.duration <= starts[1] + 300) return false;
    offsets.set(candidate.id, starts);
    return true;
  });
  test.skip(!book, "need a scanned audiobook with more than one chapter/track");

  // Seek 90s into the *second* segment so the readout has to resolve it.
  const target = offsets.get(book.id)![1] + 90;

  await page.request.put(`/api/audiobooks/${book.id}/progress`, { headers, data: { position: target } });

  try {
    await page.getByRole("heading", { name: book.title, exact: true }).first().click();
    await expect(page.getByLabel("Audiobook player")).toBeVisible();

    // The readout resolves to segment 2 (index 1).
    const readout = page.getByTestId("position-readout");
    await expect(readout).toContainText(/^(Track|Chapter) 2\b/);
    await expect(page.getByTestId("chapter-readout")).toContainText("1:30 into this");

    // Book-level percentage and remaining time are shown at the same time as
    // the chapter figure — this is the dual-progress point of spec 14.
    const bookReadout = page.getByTestId("book-readout");
    await expect(bookReadout).toContainText(/% of the book/);
    await expect(bookReadout).toContainText(/left$/);

    // Both bars are visible simultaneously.
    await expect(page.getByLabel("Audiobook progress")).toBeVisible();
    await expect(page.getByTestId("chapter-bar")).toBeVisible();

    // A tick per segment boundary after the first, positioned inside the bar.
    const ticks = page.getByTestId("chapter-tick");
    await expect(ticks).toHaveCount(segmentCount(book) - 1);
    const [tickBox, barBox] = await Promise.all([
      ticks.first().boundingBox(),
      page.getByLabel("Audiobook progress").boundingBox(),
    ]);
    expect(barBox).not.toBeNull();
    expect(tickBox).not.toBeNull();
    expect(tickBox!.x).toBeGreaterThanOrEqual(barBox!.x - 2);
    expect(tickBox!.x).toBeLessThanOrEqual(barBox!.x + barBox!.width);

    // The chapter bar tracks the same position as the chapter readout.
    await expect(page.getByTestId("chapter-bar")).toContainText("1:30 /");
  } finally {
    await page.request.put(`/api/audiobooks/${book.id}/progress`, { headers, data: { position: 0 } });
  }
});

test("the grid shows a Continue listening section for part-finished books", async ({ page }) => {
  await page.goto("/");
  await login(page);
  await pickAnyProfile(page);
  const profileId = await page.evaluate(() => window.localStorage.getItem("profileId"));
  const headers = { "x-profile-id": profileId as string };

  const all = await books(page);
  const book = all.find((candidate) => candidate.duration > 600);
  test.skip(!book, "need a scanned audiobook");

  // Nothing in progress yet for this profile.
  await expect(page.getByRole("heading", { name: "Continue listening" })).toHaveCount(0);

  await page.request.put(`/api/audiobooks/${book.id}/progress`, { headers, data: { position: book.duration / 2 } });
  try {
    // The listing is fetched on mount, so reload to pick up the new field.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Continue listening" })).toBeVisible();
    const card = page.getByTestId("card-progress").first();
    await expect(card).toContainText(/left$/);
    // Mid-book means neither finished nor unstarted.
    await expect(card).not.toContainText("under a minute left");
  } finally {
    await page.request.put(`/api/audiobooks/${book.id}/progress`, { headers, data: { position: 0 } });
  }
});

test("a finished book drops out of Continue listening", async ({ page }) => {
  await page.goto("/");
  await login(page);
  await pickAnyProfile(page);
  const profileId = await page.evaluate(() => window.localStorage.getItem("profileId"));
  const headers = { "x-profile-id": profileId as string };

  const all = await books(page);
  const book = all.find((candidate) => candidate.duration > 600);
  test.skip(!book, "need a scanned audiobook");

  // position 0 with completed=true is how a finished book is stored.
  await page.request.put(`/api/audiobooks/${book.id}/progress`, { headers, data: { position: 0, completed: true } });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Continue listening" })).toHaveCount(0);
});

test("seeking with the timeline still lands on the requested offset", async ({ page }) => {
  // Regression guard for spec 14's refactor: the slider's seek logic moved out
  // of ChapterPlayer's markup into ProgressTimeline's onSeek callback.
  await page.goto("/");
  await login(page);
  await pickAnyProfile(page);
  const profileId = await page.evaluate(() => window.localStorage.getItem("profileId"));
  const headers = { "x-profile-id": profileId as string };

  const all = await books(page);
  const book = all.find((candidate) => candidate.duration > 600);
  test.skip(!book, "need a scanned audiobook");
  const target = Math.floor(book.duration / 2);

  try {
    await page.getByRole("heading", { name: book.title, exact: true }).first().click();
    await expect(page.getByLabel("Audiobook player")).toBeVisible();
    await seekTo(page, target);
    await expect(page.getByTestId("chapter-readout")).toContainText(/^\d+:\d\d into this/);
    await expect
      .poll(() => page.getByLabel("Audiobook progress").evaluate((element) => Number((element as HTMLInputElement).value)))
      .toBeCloseTo(target, 0);
  } finally {
    await page.request.put(`/api/audiobooks/${book.id}/progress`, { headers, data: { position: 0 } });
  }
});

test("closing the player updates the library without a manual refresh", async ({ page }) => {
  /**
   * Regression: `useLibrary` only refetched on mount and while scanning, so the
   * grid kept the `progress` values from page load. Listening in the player
   * saved to the server but the shelf never showed it.
   */
  await page.goto("/");
  await login(page);
  await pickAnyProfile(page);
  const profileId = await page.evaluate(() => window.localStorage.getItem("profileId"));
  const headers = { "x-profile-id": profileId as string };

  const all = await books(page);
  const book = all.find((candidate) => candidate.duration > 600);
  test.skip(!book, "need a scanned audiobook");
  const startAt = Math.floor(book.duration / 3);

  try {
    // Nothing in progress yet.
    await expect(page.getByRole("heading", { name: "Continue listening" })).toHaveCount(0);

    await page.getByRole("heading", { name: book.title, exact: true }).first().click();
    await expect(page.getByLabel("Audiobook player")).toBeVisible();
    await seekTo(page, startAt);

    // Play briefly so a real listening session is open — the unmount save is
    // suppressed for a player that never played.
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect
      .poll(async () => page.evaluate(() => document.querySelector("audio")?.paused), { timeout: 10_000 })
      .toBe(false);
    await expect
      .poll(() => page.getByLabel("Audiobook progress").evaluate((element) => Number((element as HTMLInputElement).value)), { timeout: 10_000 })
      .toBeGreaterThan(startAt);

    // Back to the library. No reload, no refresh button — just closing.
    const close = page.getByRole("button", { name: "Close details" });
    await close.click();
    await expect(page.getByLabel("Audiobook player")).toBeHidden();

    // The grid must pick the new position up on its own.
    await expect(page.getByRole("heading", { name: "Continue listening" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("card-progress").first()).toContainText(/left$/);

    // And the refetch must not blank the shelf with the loading placeholder.
    await expect(page.getByText(/Loading library/)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Your audiobooks" })).toBeVisible();

    // The server agrees with what the grid is now showing.
    const server = await page.request.get(`/api/audiobooks/${book.id}/progress`, { headers });
    const saved = (await server.json()).position as number;
    expect(saved).toBeGreaterThan(startAt);
  } finally {
    await page.request.put(`/api/audiobooks/${book.id}/progress`, { headers, data: { position: 0 } });
  }
});
