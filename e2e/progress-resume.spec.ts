import { test, expect } from "@playwright/test";
import { ensureAuthed, login, pickAnyProfile } from "./helpers";

/**
 * End-to-end resume check (spec 04): progress saved for a profile is
 * restored automatically when the book is opened again.
 */
test("reopening a book resumes at the saved position", async ({ page }) => {
  await page.goto("/");
  await login(page);

  // A book long enough to hold the probe position: the server clamps progress
  // to the book's duration, so a short book would silently store something
  // other than 500 and make this assertion pass or fail for the wrong reason.
  const all = await (await page.request.get("/api/audiobooks")).json() as { id: number; title: string; duration: number }[];
  const book = all.find((candidate) => candidate.duration > 600);
  test.skip(!book, "need a scanned audiobook longer than 10 minutes");

  // Fresh browser context: no profile selected yet, so the profile
  // gate must appear. Any profile will do — never hardcode a seeded name.
  await pickAnyProfile(page);

  const profileId = await page.evaluate(() => window.localStorage.getItem("profileId"));
  expect(profileId).toMatch(/^[1-9]\d*$/);
  const headers = { "x-profile-id": profileId as string };
  const readPosition = async () => {
    const response = await page.request.get(`/api/audiobooks/${book.id}/progress`, { headers });
    expect(response.ok()).toBeTruthy();
    return (await response.json()).position as number;
  };

  try {
    // Save a position server-side for this profile, as a prior session would.
    const saved = await page.request.put(`/api/audiobooks/${book.id}/progress`, {
      headers,
      data: { position: 500 },
    });
    expect(saved.ok()).toBeTruthy();
    expect((await saved.json()).position).toBe(500);

    // Open the book: the player must pick up the saved position. Merely opening
    // must not overwrite it, either.
    await page.getByRole("heading", { name: book.title, exact: true }).first().click();
    await expect(page.getByLabel("Audiobook player")).toBeVisible();
    await expect
      .poll(() => page.getByLabel("Audiobook progress").evaluate((el) => Number((el as HTMLInputElement).value)))
      .toBeCloseTo(500, 0);
    expect(await readPosition(), "opening a book must not destroy the saved position").toBe(500);
  } finally {
    const reset = await page.request.put(`/api/audiobooks/${book.id}/progress`, { headers, data: { position: 0 } });
    expect(reset.ok()).toBeTruthy();
    await expect.poll(readPosition).toBe(0);
  }
});

test("switching books saves and restores the latest seek position", async ({ page }) => {
  await page.goto("/");
  await login(page);

  // Pick books by unique title and a duration that can hold the seek target;
  // the server clamps positions to the book duration, so a short books[0]
  // would make the expected 1800 unreachable.
  const allBooks = await (await page.request.get("/api/audiobooks")).json() as { id: number; title: string; duration: number }[];
  const unique = new Map<string, { id: number; title: string; duration: number }>();
  for (const candidate of allBooks) if (!unique.has(candidate.title)) unique.set(candidate.title, candidate);
  const candidates = [...unique.values()];
  const book = candidates.find((candidate) => candidate.duration > 1800);
  const otherBook = candidates.find((candidate) => candidate.id !== book?.id);
  test.skip(!book || !otherBook, "need two books with distinct titles and one longer than 30 minutes");

  await pickAnyProfile(page);
  const profileId = await page.evaluate(() => window.localStorage.getItem("profileId"));
  // The server requires an integer id >= 1; "0" or "null" would look truthy.
  expect(profileId).toMatch(/^[1-9]\d*$/);
  const headers = { "x-profile-id": profileId as string };

  // Scope to the library grid: while the detail modal is open the same title
  // is rendered twice (h3 in the grid, h2 in the modal).
  const openBook = async (title: string) => {
    await page.getByRole("heading", { name: title, exact: true }).first().click();
    await expect(page.getByLabel("Audiobook player")).toBeVisible();
  };
  const closeBook = async () => {
    const close = page.getByRole("button", { name: "Close details" });
    if (!(await close.isVisible().catch(() => false))) return;
    await close.click();
    await expect(page.getByLabel("Audiobook player")).toBeHidden();
  };
  const readPosition = async () => {
    const response = await page.request.get(`/api/audiobooks/${book.id}/progress`, { headers });
    expect(response.ok(), "progress read must be authorised").toBeTruthy();
    return (await response.json()).position as number;
  };

  try {
    await openBook(book.title);
    const progress = page.getByLabel("Audiobook progress");
    await progress.evaluate((element) => {
      const slider = element as HTMLInputElement;
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setValue?.call(slider, "1800");
      // `input` only: React's onChange for a range input listens to that
      // event, and adding `change` makes one gesture run the handler twice.
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Compare numerically: the slider is a range input over float offsets, so a
    // string-exact "1800" can fail on a rounding artefact.
    await expect.poll(() => progress.evaluate((el) => Number((el as HTMLInputElement).value))).toBeCloseTo(1800, 0);
    await closeBook();
    await expect.poll(readPosition).toBeCloseTo(1800, 0);

    await openBook(otherBook.title);
    await closeBook();
    await openBook(book.title);
    await expect
      .poll(() => page.getByLabel("Audiobook progress").evaluate((el) => Number((el as HTMLInputElement).value)))
      .toBeCloseTo(1800, 0);
  } finally {
    // closeBook auto-waits and tolerates an already-closed modal, so always
    // call it: a count() probe would miss a modal that is mid-open and leave
    // the player's unmount save to race the reset below.
    await closeBook();
    const reset = await page.request.put(`/api/audiobooks/${book.id}/progress`, {
      headers,
      data: { position: 0 },
    });
    expect(reset.ok(), "progress reset must be authorised").toBeTruthy();
    await expect.poll(readPosition).toBe(0);
  }
});
