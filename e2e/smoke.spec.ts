import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test("app loads and shows library heading", async ({ page }) => {
  await page.goto("/");
  await login(page);
  await expect(page.getByRole("heading", { name: "Audiobook Manager" })).toBeVisible();
  await expect(page.getByText(/Scan local folders/)).toBeVisible();
});

test("pwa manifest is linked and served", async ({ page, request }) => {
  await page.goto("/");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBeTruthy();
  const res = await request.get(href as string);
  expect(res.ok()).toBeTruthy();
  const manifest = await res.json();
  expect(manifest.display).toBe("standalone");
});
