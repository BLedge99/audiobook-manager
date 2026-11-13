/**
 * Spec 38 — kids accounts, end to end.
 *
 * The admin side is driven through the admin-panel API (the panel's own
 * build is a production artifact); the listener side through the real UI:
 * the kid signs in from the account picker and sees only what the age gate
 * allows. Everything the test creates is cleaned up at the end.
 */
import { test, expect, request as playwrightRequest } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { E2E_API_URL, E2E_BASE_URL } from "./helpers";

const ADMIN_PORT = process.env.ADMIN_PORT || "3100";
const ADMIN_BASE = `http://localhost:${ADMIN_PORT}`;

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

test.describe("kids accounts (spec 38)", () => {
  test("a child sees only age-appropriate books; media URLs follow", async ({ page }) => {
    const adminPassword = readAdminPassword();
    test.skip(adminPassword === null, "ADMIN_PANEL_PASSWORD not configured in .env or environment");

    const kidName = `E2E Kid ${Date.now().toString(36)}`;
    const kidPassword = "e2e-kids-strong-password";

    const admin = await playwrightRequest.newContext({ baseURL: ADMIN_BASE });
    const login = await admin.post("/api/admin/login", { data: { password: adminPassword! } });
    expect(login.ok()).toBeTruthy();

    // The library must contain at least one scanned book; point the server at
    // the checked-in LibriVox fixtures and scan if it does not (idempotent:
    // the fixture root is an upsert).
    const prefilled = await admin.get("/api/admin/age-ratings/books");
    const preBooks = (await prefilled.json()).books ?? [];
    if (preBooks.length === 0) {
      for (const candidate of ["/test", path.resolve(__dirname, "..", "test")]) {
        const created = await admin.post("/api/admin/library-roots", { data: { path: candidate, label: "e2e-kids-fixture" } });
        if (created.status() === 400) continue; // inaccessible from inside the container; try the next
        expect(created.ok(), `adding fixture root ${candidate}`).toBeTruthy();
        const root = await created.json();
        await admin.post("/api/admin/scan", { data: { rootId: root.id } });
        await expect
          .poll(async () => {
            const res = await admin.get("/api/admin/age-ratings/books");
            return ((await res.json()).books ?? []).length;
          }, { timeout: 180_000, intervals: [2000, 4000, 8000] })
          .toBeGreaterThanOrEqual(1);
        break;
      }
    }

    let kidId: number | null = null;
    let hiddenBook: { id: number; title: string } | null = null;
    try {
      // 1) Create the kids account (admin panel API, the only creation path).
      const created = await admin.post("/api/admin/kids-accounts", {
        data: { name: kidName, ageBand: "under-6", password: kidPassword },
      });
      expect(created.status()).toBe(201);
      kidId = (await created.json()).id as number;

      // 2) Fill the shelf with everything age-appropriate (unrated + ≤5).
      const filled = await admin.post(`/api/admin/kids-accounts/${kidId}/fill-shelf`);
      expect(filled.status()).toBe(200);
      const fill = await filled.json();
      expect(fill.totalAgeAppropriate).toBeGreaterThanOrEqual(1);

      // 3) Take one book off the child's shelf by rating it 16+.
      const booksRes = await admin.get("/api/admin/age-ratings/books");
      expect(booksRes.ok()).toBeTruthy();
      const { books } = await booksRes.json();
      expect(Array.isArray(books) && books.length).toBeTruthy();
      hiddenBook = { id: books[0].id, title: books[0].title };
      const set = await admin.post("/api/admin/age-ratings/set", {
        data: { mediaItemId: hiddenBook.id, minimumAge: 16 },
      });
      expect(set.ok()).toBeTruthy();

      // 4) The child signs in from the account picker (password prompt).
      await page.goto(E2E_BASE_URL);
      await expect(page.getByRole("heading", { name: "Who's listening?" })).toBeVisible({ timeout: 15_000 });
      await page.getByRole("button", { name: kidName, exact: true }).click();
      await page.locator("#profile-password").fill(kidPassword);
      await page.locator("#profile-password").press("Enter");
      await expect(page.getByRole("heading", { name: "Your audiobooks" })).toBeVisible({ timeout: 15_000 });

      // 5) The library payload excludes the hidden book; the grid agrees.
      const list = await page.request.get(`${E2E_API_URL}/api/audiobooks`);
      expect(list.ok()).toBeTruthy();
      const visible = (await list.json()) as { id: number; title: string }[];
      expect(visible.some((book) => book.id === hiddenBook!.id)).toBe(false);
      expect(visible.length).toBeGreaterThanOrEqual(1);
      await expect(page.getByText(hiddenBook.title)).toHaveCount(0);
      await expect(page.getByText(visible[0].title).first()).toBeVisible();

      // 6) Media need a visible book: the hidden book's token is refused.
      const hiddenToken = await page.request.post(`${E2E_API_URL}/api/auth/media-token`, {
        data: { kind: "book-stream", id: hiddenBook.id },
      });
      expect(hiddenToken.status()).toBe(404);

      const visibleBook = visible[0];
      const visibleToken = await page.request.post(`${E2E_API_URL}/api/auth/media-token`, {
        data: { kind: "book-stream", id: visibleBook.id },
      });
      expect(visibleToken.status()).toBe(200);

      // 7) The child cannot reach the household-wide review queue (403).
      const queue = await page.request.get(`${E2E_API_URL}/api/enrichment/review-queue`);
      expect(queue.status()).toBe(403);
    } finally {
      if (kidId !== null) {
        await admin.delete(`/api/admin/kids-accounts/${kidId}`);
      }
      if (hiddenBook) {
        // Return the book to unrated so later runs of the suite see the same shelf.
        await admin.post("/api/admin/age-ratings/set", { data: { mediaItemId: hiddenBook.id, minimumAge: null } });
      }
      await admin.dispose();
    }
  });
});
