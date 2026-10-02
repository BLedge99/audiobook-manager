import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test("app loads and shows library heading", async ({ page }) => {
  await page.goto("/");
  await login(page);
  await expect(page.getByRole("heading", { name: "Audiobook Manager" })).toBeVisible();
  await expect(page.getByText(/Scan local folders/)).toBeVisible();
});
