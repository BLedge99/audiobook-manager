import { Page } from "@playwright/test";

export const E2E_PASSWORD = process.env.E2E_APP_PASSWORD || "household";

/** Sign in through the household login gate (no-op if the gate isn't shown). */
export async function login(page: Page): Promise<void> {
  const passwordBox = page.getByPlaceholder("Household password");
  if (await passwordBox.isVisible().catch(() => false)) {
    await passwordBox.fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await passwordBox.waitFor({ state: "detached", timeout: 10_000 }).catch(() => undefined);
  }
}
