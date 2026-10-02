import { test, expect } from "@playwright/test";

test("app loads and shows library heading", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Audiobook Manager" })).toBeVisible();
  await expect(page.getByText(/Scan local folders/)).toBeVisible();
});
