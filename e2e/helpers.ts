import { expect, type Page } from "@playwright/test";

export const E2E_PASSWORD = process.env.E2E_APP_PASSWORD || "household";

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
}

/** Pass the "who's listening?" profile gate by picking an existing profile. */
export async function pickProfile(page: Page, name: string): Promise<void> {
  await expect(page.getByRole("heading", { name: "Who's listening?" })).toBeVisible();
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("heading", { name: "Audiobook Manager" })).toBeVisible();
}
