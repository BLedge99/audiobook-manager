import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { ensureAuthed, login, pickAnyProfile } from "./helpers";

/**
 * Resume across a book switch (spec 04): play book A, skip to 3 minutes,
 * listen for a second, switch to book B for a second, then reopen book A —
 * it must resume about a second past the 3-minute mark, not from the start
 * and not from book B's position.
 *
 * Rigour notes:
 * - The server is polled directly after closing book A, so a broken or
 *   missing save-on-close fails the test even if the client looks right.
 * - Both the audio element's `currentTime` AND the overall book position
 *   (the slider) are asserted. For multi-track books `currentTime` is the
 *   time within the playing track, so the expected media time is derived
 *   from the book's track layout; the slider displays the overall position
 *   the user actually cares about.
 * - Playing book B in between must not disturb book A's saved position.
 * - The final acceptance window is 3 minutes ± 30 seconds.
 */

const SEEK_TARGET = 180; // 3 minutes, in seconds
const PLAYED_SECONDS = 1;
const RESUME_WINDOW: [number, number] = [150, 210]; // 3 minutes ± 30 seconds
const SAVED_WINDOW: [number, number] = [175, 195]; // ~3 minutes + 1 second of playback

type Track = { id: number; trackNumber: number; duration: number };
type Book = { id: number; title: string; duration: number; tracks: Track[] };

async function fetchBooks(page: Page): Promise<Book[]> {
  await ensureAuthed(page);
  return (await (await page.request.get("/api/audiobooks")).json()) as Book[];
}

async function audioState(page: Page) {
  return page.evaluate(() => {
    const audio = document.querySelector("audio");
    return audio ? { time: audio.currentTime, paused: audio.paused } : { time: -1, paused: true };
  });
}

async function readSlider(page: Page): Promise<number> {
  return page.getByLabel("Audiobook progress").evaluate((element) => Number((element as HTMLInputElement).value));
}

async function serverPosition(page: Page, bookId: number, headers: Record<string, string>) {
  await ensureAuthed(page);
  const response = await page.request.get(`/api/audiobooks/${bookId}/progress`, { headers });
  return (await response.json()).position as number;
}

async function openBook(page: Page, title: string) {
  // `.first()` because a part-finished book is rendered twice: once in the
  // "Continue listening" row and once in "All audiobooks" (spec 14). Both are
  // legitimately headings, so an unscoped locator is a strict-mode violation.
  await page.getByRole("heading", { name: title, exact: true }).first().click();
  await expect(page.getByLabel("Audiobook player")).toBeVisible();
}

async function closeBook(page: Page) {
  const close = page.getByRole("button", { name: "Close details" });
  // Tolerate an already-closed modal so this is safe in a finally block.
  if (!(await close.isVisible().catch(() => false))) return;
  await close.click();
  await expect(page.getByLabel("Audiobook player")).toBeHidden();
}

async function seekTo(page: Page, seconds: number) {
  const slider = page.getByLabel("Audiobook progress");
  await slider.evaluate((element, target) => {
    const input = element as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setValue?.call(input, String(target));
    // React's onChange for a range input listens to `input` only. Also
    // dispatching `change` makes the handler run twice for one user gesture,
    // which is not what a real drag does.
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, seconds);
}

/**
 * Overall book position -> the `audio.currentTime` the app should end up at.
 * For single-file/chapter books the media time IS the overall position; for
 * multi-track books it is the offset inside the playing track.
 */
function expectedMediaTime(book: Book, overall: number): number {
  const tracks = [...book.tracks].sort((a, b) => a.trackNumber - b.trackNumber);
  if (tracks.length === 0) return overall;
  let offset = 0;
  for (const track of tracks) {
    if (overall < offset + track.duration) return overall - offset;
    offset += track.duration;
  }
  return Math.max(0, overall - offset);
}

/** Best-effort: point the server at the repo's LibriVox fixtures and scan. */
async function provisionLibrary(page: Page): Promise<void> {
  await ensureAuthed(page);
  for (const candidate of [path.resolve(__dirname, "..", "test"), "/test"]) {
    const created = await page.request.post("/api/library-roots", { data: { path: candidate, label: "e2e-resume-fixture" } });
    // Only an inaccessible path is worth retrying elsewhere; anything else is
    // a real error that must not be swallowed into a silent skip.
    if (created.status() === 400) continue;
    if (!created.ok()) throw new Error(`Adding library root ${candidate} failed with ${created.status()}`);
    try {
      const root = (await created.json()) as { id: number };
      await page.request.post("/api/scan", { data: { rootId: root.id } });
      await expect
        .poll(async () => (await fetchBooks(page)).length, { timeout: 180_000, intervals: [2000, 4000, 8000] })
        .toBeGreaterThanOrEqual(2);
      return;
    } catch {
      // Try the next candidate path.
    }
  }
}

test("resumes the first book at the saved position after playing a different book in between", async ({ page }) => {
  test.setTimeout(300_000);

  await page.goto("/");
  await login(page);

  const suitableBooks = (books: Book[]) => {
    const byTitle = new Map<string, Book>();
    for (const book of books) {
      if (book.duration > RESUME_WINDOW[1] + 30 && !byTitle.has(book.title)) byTitle.set(book.title, book);
    }
    return [...byTitle.values()];
  };

  let suitable = suitableBooks(await fetchBooks(page));
  if (suitable.length < 2) {
    await provisionLibrary(page);
    // The client only polls while a scan is running; reload so the grid
    // definitely reflects the freshly scanned library.
    await page.reload();
    await login(page);
    suitable = suitableBooks(await fetchBooks(page));
  }
  const [bookA, bookB] = suitable;
  if (!bookA || !bookB) {
    test.skip(true, "need at least two distinct books longer than 4 minutes");
    return;
  }

  await pickAnyProfile(page);

  const profileId = await page.evaluate(() => window.localStorage.getItem("profileId"));
  expect(profileId).toBeTruthy();
  const headers = { "x-profile-id": profileId as string };

  // Clean slate: the test must not depend on state left by earlier runs.
  await page.request.put(`/api/audiobooks/${bookA.id}/progress`, { headers, data: { position: 0 } });
  await page.request.put(`/api/audiobooks/${bookB.id}/progress`, { headers, data: { position: 0 } });

  try {
    // 1. Open the first book and skip to 3 minutes.
    await openBook(page, bookA.title);
    await seekTo(page, SEEK_TARGET);
    // The media element must actually seek (within-track time depends on the
    // book's layout), and the displayed overall position must read 3 minutes.
    await expect.poll(async () => (await audioState(page)).time, { timeout: 15_000 }).toBeCloseTo(expectedMediaTime(bookA, SEEK_TARGET), 0);
    await expect.poll(() => readSlider(page), { timeout: 15_000 }).toBeCloseTo(SEEK_TARGET, 0);

    // 2. Let it play for ~1 second.
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect.poll(async () => (await audioState(page)).paused, { timeout: 10_000 }).toBe(false);
    await expect.poll(() => readSlider(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(SEEK_TARGET + PLAYED_SECONDS);

    // 3. Back to the library — closing must persist ~3m1s server-side.
    await closeBook(page);
    await expect.poll(() => serverPosition(page, bookA.id, headers), { timeout: 15_000 }).toBeGreaterThanOrEqual(SAVED_WINDOW[0]);
    expect(await serverPosition(page, bookA.id, headers)).toBeLessThanOrEqual(SAVED_WINDOW[1]);

    // 4. Play a different book for ~1 second.
    await openBook(page, bookB.title);
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect.poll(async () => (await audioState(page)).paused, { timeout: 10_000 }).toBe(false);
    // Require the media element to actually advance, not merely a non-zero
    // slider: book B starts at 0, so ">= 1" could be satisfied by a stale
    // restore without anything having played.
    await expect.poll(async () => (await audioState(page)).time, { timeout: 10_000 }).toBeGreaterThanOrEqual(PLAYED_SECONDS);
    await closeBook(page);

    // The detour must not disturb the first book's saved position.
    const positionAfterDetour = await serverPosition(page, bookA.id, headers);
    expect(positionAfterDetour).toBeGreaterThanOrEqual(SAVED_WINDOW[0]);
    expect(positionAfterDetour).toBeLessThanOrEqual(SAVED_WINDOW[1]);

    // 5. Reopen the first book — it must restore the saved position, and
    //    opening it must not destroy that position along the way.
    await openBook(page, bookA.title);
    await expect.poll(() => serverPosition(page, bookA.id, headers), { timeout: 15_000 }).toBeGreaterThanOrEqual(SAVED_WINDOW[0]);
    expect(await serverPosition(page, bookA.id, headers)).toBeLessThanOrEqual(SAVED_WINDOW[1]);
    await expect.poll(async () => (await audioState(page)).time, { timeout: 15_000 }).toBeCloseTo(expectedMediaTime(bookA, positionAfterDetour), 0);
    await expect.poll(() => readSlider(page), { timeout: 15_000 }).toBeCloseTo(positionAfterDetour, 0);

    // 6. Press play — playback must continue from ~3 minutes (3m ± 30s).
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect.poll(async () => (await audioState(page)).paused, { timeout: 15_000 }).toBe(false);

    // Freeze playback so the final reading is not a race against the clock.
    await page.evaluate(() => { document.querySelector("audio")?.pause(); });
    const finalMediaTime = (await audioState(page)).time;
    const finalPosition = await readSlider(page);
    expect(finalPosition).toBeGreaterThanOrEqual(RESUME_WINDOW[0]);
    expect(finalPosition).toBeLessThanOrEqual(RESUME_WINDOW[1]);
    // The media element must agree with the displayed position.
    expect(finalMediaTime).toBeCloseTo(expectedMediaTime(bookA, finalPosition), 0);
  } finally {
    // closeBook auto-waits and tolerates an absent modal; a count() probe can
    // miss a modal that is mid-open and let the player's fire-and-forget
    // unmount save race the resets below.
    await closeBook(page);
    const resetA = await page.request.put(`/api/audiobooks/${bookA.id}/progress`, { headers, data: { position: 0 } });
    const resetB = await page.request.put(`/api/audiobooks/${bookB.id}/progress`, { headers, data: { position: 0 } });
    expect(resetA.ok(), "progress reset must be authorised").toBeTruthy();
    expect(resetB.ok(), "progress reset must be authorised").toBeTruthy();
    // The unmount save must not resurrect the position after the reset.
    await expect.poll(() => serverPosition(page, bookA.id, headers)).toBe(0);
  }
});
