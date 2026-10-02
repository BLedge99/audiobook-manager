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
