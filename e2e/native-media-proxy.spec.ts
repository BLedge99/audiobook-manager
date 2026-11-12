import { test, expect, type Page } from "@playwright/test";
import { login, pickAnyProfile } from "./helpers";

/**
 * Pins the client half of the Android remote-playback fix.
 *
 * Headless Chromium cannot execute the Java WebView interceptor, and jsdom
 * cannot decode media, so this test drives the real app in a real browser
 * with a stubbed native shell (`window.Capacitor`) and asserts the one thing
 * both halves rely on: the `<audio>` element's src is always the app-origin
 * proxy URL, never an absolute http(s) stream URL (which Chrome blocks as
 * mixed content on the `https://localhost` origin). The interceptor itself is
 * verified on-device (see specs/26 and decisions/031); the URL-routing logic
 * is unit-tested in `client/src/lib/mediaProxy.test.ts`.
 *
 * The stubbed shell also exercises the in-memory session-token path the shell
 * really uses: after UI login, `usePlayerSource` mints a scoped media token
 * through `POST /api/auth/media-token` before pointing the element at the
 * proxy URL.
 */

const PROXY_PREFIX = "https://localhost/_media?url=";

async function streamSrc(page: Page, bookTitle: string): Promise<string> {
  await page.getByRole("heading", { name: bookTitle, exact: true }).first().click();
  const player = page.getByRole("region", { name: "Audiobook player" });
  await expect(player).toBeVisible();
  const audio = player.locator("audio");
  await expect
    .poll(() => audio.evaluate((element) => (element as HTMLAudioElement).getAttribute("src") ?? ""), { timeout: 15_000 })
    .not.toBe("");
  return audio.evaluate((element) => (element as HTMLAudioElement).getAttribute("src") ?? "");
}

async function findABook(page: Page) {
  const books = (await (await page.request.get("/api/audiobooks")).json()) as { id: number; title: string }[];
  const book = books[0];
  test.skip(!book, "need at least one scanned audiobook");
  return book;
}

test("native shell routes the stream URL through the app-origin media proxy", async ({ page }) => {
  // Stub the native shell before any app code runs, and point the app at the
  // vite dev origin (same-origin API through the dev proxy), exactly like the
  // installed APK points it at the household server.
  await page.addInitScript((serverUrl: string) => {
    window.localStorage.setItem("serverUrl", serverUrl);
    // The `https://localhost` Android shell's native bridge injects
    // `window.androidBridge` before the app loads; `isNativeShell()` checks it
    // first, so it is the reliable seam regardless of what the bundle's
    // `@capacitor/core` evaluation does to `window.Capacitor` later.
    (window as { androidBridge?: unknown }).androidBridge = {};
  }, "http://localhost:5173");

  await page.goto("/");
  await login(page);
  const book = await findABook(page);
  await pickAnyProfile(page);

  const src = await streamSrc(page, book.title);
  expect(src.startsWith(PROXY_PREFIX)).toBe(true);

  // The inner URL is the absolute stream URL with a scoped media token.
  const inner = decodeURIComponent(src.slice(PROXY_PREFIX.length));
  expect(inner).toMatch(/^http:\/\/localhost:5173\/api\/(audiobooks\/\d+\/stream|tracks\/\d+\/stream)\?media=.+/);
});

test("web build points the element straight at the same-origin stream (no proxy)", async ({ page }) => {
  await page.goto("/");
  await login(page);
  const book = await findABook(page);
  await pickAnyProfile(page);

  const src = await streamSrc(page, book.title);
  expect(src).not.toContain("_media");
  expect(src).toMatch(/^\/api\/(audiobooks\/\d+\/stream|tracks\/\d+\/stream)/);
});
