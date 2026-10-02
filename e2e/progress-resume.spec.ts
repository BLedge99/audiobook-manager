import { test, expect } from "@playwright/test";
import { login, pickProfile } from "./helpers";

/**
 * End-to-end resume check (spec 04): progress saved for a profile is
 * restored automatically when the book is opened again.
 */
test("reopening a book resumes at the saved position", async ({ page }) => {
  await page.goto("/");
  await login(page);

  const books = await (await page.request.get("/api/audiobooks")).json();
  test.skip(books.length === 0, "library is empty — add a root and scan first");
  const book = books[0] as { id: number; title: string };

  // Fresh browser context: no profile selected yet, so the profile
  // gate must appear. Pick the seeded "Testing" profile.
  await pickProfile(page, "Testing");

  const profileId = await page.evaluate(() => window.localStorage.getItem("profileId"));
  expect(profileId).toBeTruthy();

  // Save a position server-side for this profile, as a prior session would.
  const saved = await page.request.put(`/api/audiobooks/${book.id}/progress`, {
    headers: { "x-profile-id": profileId as string },
    data: { position: 500 },
  });
  expect(saved.ok()).toBeTruthy();
  expect((await saved.json()).position).toBe(500);

  // Open the book: the player must pick up the saved position.
  await page.getByRole("heading", { name: book.title }).click();
  await expect(page.getByLabel("Audiobook player")).toBeVisible();
  await expect(page.getByLabel("Audiobook progress")).toHaveValue("500");

  // Reset so the next run starts from a clean position.
  await page.request.put(`/api/audiobooks/${book.id}/progress`, {
    headers: { "x-profile-id": profileId as string },
    data: { position: 0 },
  });
});

test("switching books saves and restores the latest seek position", async ({ page }) => {
  await page.goto("/");
  await login(page);

  const books = await (await page.request.get("/api/audiobooks")).json() as { id: number; title: string; duration: number }[];
  const book = books.find((candidate) => candidate.duration > 1800);
  const otherBook = books.find((candidate) => candidate.id !== book?.id);
  test.skip(!book || !otherBook, "need two books and one longer than 30 minutes");

  await pickProfile(page, "Playwright");
  const profileId = await page.evaluate(() => window.localStorage.getItem("profileId"));
  expect(profileId).toBeTruthy();
  const headers = { "x-profile-id": profileId as string };

  const openBook = async (title: string) => {
    await page.getByRole("heading", { name: title }).click();
    await expect(page.getByLabel("Audiobook player")).toBeVisible();
  };
  const closeBook = async () => page.getByRole("button", { name: "Close details" }).click();
  const readPosition = async () => {
    const response = await page.request.get(`/api/audiobooks/${book.id}/progress`, { headers });
    return (await response.json()).position as number;
  };

  try {
    await openBook(book.title);
    const progress = page.getByLabel("Audiobook progress");
    await progress.evaluate((element) => {
      const slider = element as HTMLInputElement;
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setValue?.call(slider, "1800");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      slider.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(progress).toHaveValue("1800");
    await closeBook();
    await expect.poll(readPosition).toBeCloseTo(1800, 0);

    await openBook(otherBook.title);
    await closeBook();
    await openBook(book.title);
    await expect(page.getByLabel("Audiobook progress")).toHaveValue("1800");
  } finally {
    if (await page.getByRole("button", { name: "Close details" }).count()) await closeBook();
    await page.request.put(`/api/audiobooks/${book.id}/progress`, {
      headers,
      data: { position: 0 },
    });
  }
});
