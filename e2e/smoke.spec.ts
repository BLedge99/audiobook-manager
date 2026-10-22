import { test, expect } from "@playwright/test";
import { login, pickAnyProfile } from "./helpers";

test("app loads and shows library heading", async ({ page }) => {
  await page.goto("/");
  await login(page);
  // Any profile will do, so never depend on a specific seeded name here.
  await pickAnyProfile(page);
  await expect(page.getByRole("heading", { name: "Audiobook Manager" })).toBeVisible();
  await expect(page.getByText(/Your library is empty/)).toBeVisible();
});

test("pwa manifest is linked and served", async ({ page }) => {
  await page.goto("/");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBeTruthy();
  // Resolve against the page origin: in dev the href is served by Vite, in a
  // production single-origin build it comes from the API. Using the bare href
  // against E2E_BASE_URL can therefore 404 in one mode or the other.
  const res = await page.request.get(new URL(href as string, page.url()).toString());
  expect(res.ok()).toBeTruthy();
  expect(res.headers()["content-type"], "manifest must be JSON, not the SPA index").toContain("json");
  const manifest = await res.json();
  expect(manifest.display).toBe("standalone");
});
