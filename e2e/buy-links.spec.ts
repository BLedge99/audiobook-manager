/**
 * Spec 39 — buy links (Feature B), end to end.
 *
 * Adult: Discover cards carry a Get button; the sheet renders the Free row
 * (server-intercepted LibriVox match), every paid row, and the untagged
 * disclosure; tapping a row launches in a popup. Child: no affordance exists.
 * The /api/buy-context route is intercepted so the test never depends on a
 * live third-party call.
 */
import { test, expect, request as playwrightRequest } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { E2E_BASE_URL, login, pickAnyProfile } from "./helpers";

const MATCH = {
  librivox: {
    id: "365",
    title: "Picture of Dorian Gray",
    url: "https://librivox.org/picture-of-dorian-gray-version-3/",
  },
};

function adminBaseUrl(): string {
  if (process.env.E2E_ADMIN_URL) return process.env.E2E_ADMIN_URL;
  try {
    const env = fs.readFileSync(path.resolve(__dirname, "..", ".env"), "utf8");
    const line = env.split(/\r?\n/).find((entry) => entry.startsWith("ADMIN_PORT="));
    const port = line?.slice("ADMIN_PORT=".length).trim();
    return `http://localhost:${port || "3100"}`;
  } catch {
    return "http://localhost:3100";
  }
}

function adminPassword(): string | null {
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

test.describe("buy links (spec 39)", () => {
  test("adult: Get this book on a Discover card opens the sheet with all rows untagged", async ({ page }) => {
    await page.route("**/api/buy-context**", async (route) => {
      await route.fulfill({ json: MATCH });
    });

    await page.goto(E2E_BASE_URL);
    await login(page);
    await pickAnyProfile(page);

    const profileId = await page.evaluate(() => window.localStorage.getItem("profileId"));
    const headers = { "x-profile-id": profileId ?? "1" };

    const library = await (await page.request.get("/api/audiobooks", { headers })).json();
    expect(library.length).toBeGreaterThan(0);
    for (const book of library.slice(0, 3)) {
      await page.request.put(`/api/audiobooks/${book.id}/favourite`, { headers });
    }

    // Navigate by role; the sibling spec's tab helper is not exported.
    await page.getByRole("button", { name: /^Discover$/ }).click();

    // Recommendations depend on a live provider call; allow generous time.
    const getButton = page.getByRole("button", { name: "Get this book" }).first();
    await expect(getButton).toBeVisible({ timeout: 60_000 });
    await getButton.click();

    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();

    // Free row: first position, untagged, correct href from the intercepted call.
    const freeRow = sheet.locator("[data-row='librivox']");
    await expect(freeRow).toBeVisible();
    await expect(freeRow.locator("a")).toHaveAttribute("href", MATCH.librivox.url);

    // Every paid row renders with the untagged disclosure footer (no AD cues).
    for (const vendor of ["Libro.fm", "Bookshop.org", "Barnes & Noble", "Kobo", "Audible", "Google Play Books"]) {
      await expect(sheet.getByRole("button", { name: new RegExp(vendor) })).toBeVisible();
    }
    await expect(sheet.getByText(/we may earn a commission/i)).toHaveCount(0);
    await expect(sheet.getByText(/do not earn a commission/i)).toBeVisible();

    // Tapping a row launches (popup) at the vendor, not an in-app WebView.
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      sheet.getByRole("button", { name: /Audible/ }).click(),
    ]);
    await popup.waitForLoadState("domcontentloaded");
    expect(popup.url()).toMatch(/audible\./); // geo-redirect may land on .co.uk etc.
    await popup.close();
  });

  test("child: no buy link affordance anywhere", async ({ page }) => {
    const password = adminPassword();
    test.skip(password === null, "ADMIN_PANEL_PASSWORD not configured");

    const admin = await playwrightRequest.newContext({ baseURL: adminBaseUrl() });
    const loginRes = await admin.post("/api/admin/login", { data: { password } });
    expect(loginRes.ok()).toBeTruthy();

    const kidName = `E2E Kid Buy ${Date.now().toString(36)}`;
    const kidPassword = "e2e-kids-strong-password";
    let kidId: number | null = null;
    try {
      const created = await admin.post("/api/admin/kids-accounts", {
        data: { name: kidName, ageBand: "10-13", password: kidPassword },
      });
      expect(created.status()).toBe(201);
      kidId = (await created.json()).id as number;

      await page.goto(E2E_BASE_URL);
      await expect(page.getByRole("heading", { name: "Who's listening?" })).toBeVisible({ timeout: 15_000 });
      await page.getByRole("button", { name: kidName, exact: true }).click();
      await page.locator("#profile-password").fill(kidPassword);
      await page.locator("#profile-password").press("Enter");
      await expect(page.getByRole("heading", { name: "Your audiobooks" })).toBeVisible({ timeout: 15_000 });

      await page.getByRole("button", { name: /^Discover$/ }).click();
      await expect(page.getByRole("button", { name: /Get this book/i })).toHaveCount(0);
    } finally {
      if (kidId !== null) await admin.delete(`/api/admin/kids-accounts/${kidId}`);
      await admin.dispose();
    }
  });
});
