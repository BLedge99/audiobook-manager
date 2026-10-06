import { expect, type Page } from "@playwright/test";

export const E2E_PASSWORD = process.env.E2E_APP_PASSWORD || "household";
/** Client origin under test. */
export const E2E_BASE_URL = process.env.E2E_BASE_URL || "http://localhost:5173";
/** API origin. Differs from the client origin when Vite is not proxying. */
export const E2E_API_URL = process.env.E2E_API_URL || "http://localhost:3000";

/**
 * Wait until the app itself is authenticated.
 *
 * `page.request` shares the browser context's cookie jar, but a login
 * response's `Set-Cookie` can land a moment after the UI has already
 * re-rendered. Calling an API through `page.request` in that window gets a
 * spurious 401. Every helper that touches the API waits on this first.
 */
export async function ensureAuthed(page: Page): Promise<void> {
  await expect
    .poll(async () => page.evaluate(async () => (await fetch("/api/audiobooks")).status), { timeout: 15_000 })
    .toBe(200);
}

/** Sign in through the household login gate (no-op if the gate isn't shown). */
export async function login(page: Page): Promise<void> {
  const passwordBox = page.getByPlaceholder("Household password");
  // The auth probe resolves a moment after page load, so wait briefly
  // for the gate before deciding we're already signed in.
  const gated = await passwordBox.waitFor({ state: "visible", timeout: 3_000 }).then(() => true).catch(() => false);
  if (gated) {
    await passwordBox.fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await passwordBox.waitFor({ state: "detached", timeout: 10_000 }).catch(() => undefined);
  }
  // Never hand control back until API calls will actually be authorised.
  await ensureAuthed(page);
}

/** Pass the "who's listening?" profile gate by picking an existing profile. */
export async function pickProfile(page: Page, name: string): Promise<void> {
  await expect(page.getByRole("heading", { name: "Who's listening?" })).toBeVisible();
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("heading", { name: "Audiobook Manager" })).toBeVisible();
}

/**
 * Pass the profile gate without caring *which* profile is used.
 *
 * Tests that only need "somebody is listening" must not hardcode a seeded
 * name: a fresh server seeds `DEFAULT_PROFILES`, but a database that already
 * exists may not contain any particular one, and a hardcoded name turns a
 * smoke test into a false failure. Creates a profile only if the server has
 * none at all.
 */
export async function pickAnyProfile(page: Page): Promise<string> {
  await expect(page.getByRole("heading", { name: "Who's listening?" })).toBeVisible();
  // The gate's buttons are the profile list plus "+ Add profile".
  const existing = page.getByRole("button").filter({ hasNotText: "+ Add profile" }).first();
  if (await existing.isVisible().catch(() => false)) {
    const name = ((await existing.textContent()) ?? "").trim();
    await existing.click();
    // "All audiobooks" is rendered only by the signed-in library view; the
    // heading "Audiobook Manager" also belongs to the login gate.
    await expect(page.getByRole("heading", { name: "All audiobooks" })).toBeVisible();
    return name;
  }
  const name = `E2E Auto ${Date.now().toString(36)}`;
  await page.getByRole("button", { name: "+ Add profile" }).click();
  await page.getByPlaceholder("Name").fill(name);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("heading", { name: "All audiobooks" })).toBeVisible();
  return name;
}

/**
 * Delete every profile matching a predicate via the API, then reload so any
 * already-mounted gate refetches its list.
 *
 * Deleting through the API while the profile gate is on screen leaves the
 * gate holding a stale list, and its client-side duplicate check then
 * rejects a name that no longer exists. Reloading is what makes cleanup
 * actually observable. Returns the number of profiles removed.
 */
export async function deleteProfiles(page: Page, matches: (profile: { name: string }) => boolean): Promise<number> {
  await ensureAuthed(page);
  const response = await page.request.get("/api/profiles");
  const profiles = (await response.json()) as { id: number; name: string }[];
  const doomed = profiles.filter(matches);
  for (const profile of doomed) {
    await page.request.delete(`/api/profiles/${profile.id}`);
  }
  if (doomed.length) await page.reload();
  return doomed.length;
}
