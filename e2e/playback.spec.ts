import { test, expect } from "@playwright/test";
import { login, pickAnyProfile } from "./helpers";

/**
 * The only test that can prove the player plays.
 *
 * Every unit test around `ChapterPlayer` runs in jsdom, where `play()` is a
 * stub and no media ever loads. Three regressions shipped green on that basis:
 * a source that was empty in the Android shell, a chapter book that never
 * advanced, and a seek that reloaded the file and restarted it. None of them
 * is observable without a real element decoding real bytes.
 *
 * Deliberately minimal: press play and confirm the stream delivered media.
 * Anything about chapters or saves is covered by the unit suite; what is
 * *not* is whether the bytes arrive at all.
 *
 * Headless CI note: `currentTime` advancing needs an audio output device,
 * which headless WSL Chromium lacks (no ALSA card). `duration` is read from
 * the container headers, so it is > 0 as soon as the stream responds -- no
 * audio sink required. That is the required proof here; currentTime movement
 * is verified on the Pixel 4a instead.
 */

type Book = { id: number; title: string; duration: number };

test("pressing play loads media from the stream", async ({ page }) => {
  await page.goto("/");
  await login(page);

  const books = await (await page.request.get("/api/audiobooks")).json() as Book[];
  // A few seconds of audio is enough; a book shorter than this is not a book.
  const book = books.find((candidate) => candidate.duration > 30);
  test.skip(!book, "need a scanned audiobook with at least 30 seconds of audio");

  await pickAnyProfile(page);

  await page.getByRole("heading", { name: book.title, exact: true }).first().click();
  // The player is a labelled `section`, i.e. a region landmark, so everything
  // below is scoped to it -- the browse grid has its own play affordances.
  const player = page.getByRole("region", { name: "Audiobook player" });
  await expect(player).toBeVisible();

  const audio = player.locator("audio");

  // The source must exist before play is even pressed. An empty `src` is the
  // bug that made the Android shell show "Playback could not start".
  await expect
    .poll(() => audio.evaluate((element) => (element as HTMLAudioElement).getAttribute("src") ?? ""), { timeout: 15_000 })
    .not.toBe("");

  await player.getByRole("button", { name: "Play", exact: true }).click();

  // The stream must have delivered decodable media. Duration comes from the
  // container headers, so > 0 means the element read the stream -- no audio
  // output device required. currentTime advancing also needs an audio sink,
  // which headless CI lacks, so duration is the proof that bytes arrived.
  await expect
    .poll(() => audio.evaluate((element) => (element as HTMLAudioElement).duration), { timeout: 30_000 })
    .toBeGreaterThan(0);

  // Pausing sticks: the element stops and stays stopped.
  await player.getByRole("button", { name: "Pause", exact: true }).click();
  await expect.poll(() => audio.evaluate((element) => (element as HTMLAudioElement).paused)).toBe(true);
  const stoppedAt = await audio.evaluate((element) => (element as HTMLAudioElement).currentTime);
  await page.waitForTimeout(750);
  const stillAt = await audio.evaluate((element) => (element as HTMLAudioElement).currentTime);
  expect(Math.abs(stillAt - stoppedAt)).toBeLessThan(0.5);
});
