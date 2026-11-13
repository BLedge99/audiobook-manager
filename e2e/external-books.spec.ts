/**
 * Spec 39 — external books (Feature A), end to end.
 *
 * Adult flows: paste URL, preview, add, launch (popup), remove.
 * Child flow: the whole surface is absent — no button, no section.
 *
 * The stack (server :3000, client :5173, admin :3100) must be up; run with
 * `npx playwright test e2e/external-books.spec.ts` (or scripts/e2e-wsl.sh).
 */
import { test, expect, request as playwrightRequest } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { E2E_BASE_URL, login, pickAnyProfile } from "./helpers";

const ADMIN_PORT = process.env.ADMIN_PORT || "3100";
const ADMIN_BASE = `http://localhost:${ADMIN_PORT}`;

const STORE_URLS = [
  { name: "Audible", url: "https://www.audible.com/pd/The-Count-of-Monte-Cristo/B00S2LTCQK", canonical: "https://www.audible.com/pd/The-Count-of-Monte-Cristo/B00S2LTCQK" },
  { name: "Google Play Books", url: "https://play.google.com/store/audiobooks/details?id=AQAAAACf3Vbd2M", canonical: "https://play.google.com/store/audiobooks/details?id=AQAAAACf3Vbd2M" },
  { name: "Kobo", url: "https://www.kobo.com/us/en/audiobook/turtles-all-the-way-down-4", canonical: "https://www.kobo.com/us/en/audiobook/turtles-all-the-way-down-4" },
  { name: "Libro.fm", url: "https://libro.fm/audiobooks/9781705085059-fourth-wing", canonical: "https://libro.fm/audiobooks/9781705085059-fourth-wing" },
];

function readAdminPassword(): string | null {
  if (process.env.E2E_ADMIN_PASSWORD) return process.env.E2E_ADMIN_PASSWORD;
  if (process.env.ADMIN_PANEL_PASSWORD) return process.env.ADMIN_PANEL_PASSWORD;
  try {
    const env = fs.readFileSync(path.resolve(__dirname, "..", ".env"), "utf8");
    const line = env.split(/\r?\n/).find((entry) => entry.startsWith("ADMIN_PANEL_PASSWORD="));
    return line ? line.slice("ADMIN_PANEL_PASSWORD=".length).trim().replace(/^["']|["']$/g, "") : null;
  } catch {
    return null;
  }
}

test.describe("external books (spec 39)", () => {
  test("adult: add each store's URL, launch in a popup, remove", async ({ page }) => {
    await page.goto(E2E_BASE_URL);
    await login(page);
    await pickAnyProfile(page);

    const addButton = page.getByRole("button", { name: /own it elsewhere\?/i });
    await expect(addButton).toBeVisible();

    for (const store of STORE_URLS) {
      await addButton.click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByPlaceholder(/paste the book/i).fill(store.url);
      await expect(page.getByRole("button", { name: /add to my list/i })).toBeEnabled();
      await page.getByRole("button", { name: /add to my list/i }).click();
      await expect(page.getByRole("dialog")).not.toBeVisible();
      await expect(page.getByText(store.name, { exact: true })).toBeVisible();
    }

    // The popup carries the canonical URL for the first (Audible) item.
    const firstCard = page.locator("[data-external-id]").first();
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      firstCard.getByRole("button", { name: /^open /i }).first().click(),
    ]);
    expect(popup.url()).toBe(STORE_URLS[0].canonical);
    await popup.close();

    // Two-step remove: the first tap never deletes.
    const remove = page.getByRole("button", { name: /remove .* from your list/i }).first();
    await remove.click();
    await expect(page.getByText(/remove this book/i)).toBeVisible();
    await page.getByRole("button", { name: /remove this book/i }).click();
    await expect(page.locator("[data-external-id]")).toHaveCount(STORE_URLS.length - 1);
  });

  test("child: the external surface is absent entirely", async ({ page }) => {
    const adminPassword = readAdminPassword();
    test.skip(adminPassword === null, "ADMIN_PANEL_PASSWORD not configured");

    const admin = await playwrightRequest.newContext({ baseURL: ADMIN_BASE });
    const login = await admin.post("/api/admin/login", { data: { password: adminPassword! } });
    expect(login.ok()).toBeTruthy();

    const kidName = `E2E Kid Ext ${Date.now().toString(36)}`;
    const kidPassword = "e2e-kids-strong-password";
    let kidId: number | null = null;
    try {
      const created = await admin.post("/api/admin/kids-accounts", {
        data: { name: kidName, ageBand: "6-9", password: kidPassword },
      });
      expect(created.status()).toBe(201);
      kidId = (await created.json()).id as number;
      await admin.post(`/api/admin/kids-accounts/${kidId}/fill-shelf`);

      await page.goto(E2E_BASE_URL);
      await expect(page.getByRole("heading", { name: "Who's listening?" })).toBeVisible({ timeout: 15_000 });
      await page.getByRole("button", { name: kidName, exact: true }).click();
      await page.locator("#profile-password").fill(kidPassword);
      await page.locator("#profile-password").press("Enter");
      await expect(page.getByRole("heading", { name: "Your audiobooks" })).toBeVisible({ timeout: 15_000 });

      await expect(page.getByRole("button", { name: /own it elsewhere\?/i })).toHaveCount(0);
      await expect(page.getByText("From your other apps")).toHaveCount(0);
    } finally {
      if (kidId !== null) await admin.delete(`/api/admin/kids-accounts/${kidId}`);
      await admin.dispose();
    }
  });
});
