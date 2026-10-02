import { test, expect } from "@playwright/test";
import { login, pickProfile } from "./helpers";

test("login gate blocks, then allows, profile creation", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByPlaceholder("Household password")).toBeVisible();

  await page.getByPlaceholder("Household password").fill("wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Incorrect password")).toBeVisible();

  await login(page);

  // Remove any "E2E User" left by previous runs so the create below
  // is actually exercised (profile names are unique).
  const list = await page.request.get("/api/profiles");
  for (const profile of await list.json()) {
    if (profile.name === "E2E User") {
      await page.request.delete(`/api/profiles/${profile.id}`);
    }
  }

  // No profile selected yet: the profile gate appears. Creating a
  // profile through it also selects it and enters the app.
  await expect(page.getByRole("heading", { name: "Who's listening?" })).toBeVisible();
  await page.getByRole("button", { name: "+ Add profile" }).click();
  await page.getByPlaceholder("Name").fill("E2E User");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Audiobook Manager" })).toBeVisible();
  await expect(page.getByLabel("Active profile")).toContainText("E2E User");
});

test("duplicate profile names are rejected", async ({ page }) => {
  await page.goto("/");
  await login(page);
  await pickProfile(page, "Dad");

  // Clean up from previous runs first so the first add below
  // actually creates (and isn't a 409 from stale state).
  const before = await page.request.get("/api/profiles");
  for (const profile of await before.json()) {
    if (profile.name === "E2E Dup") {
      await page.request.delete(`/api/profiles/${profile.id}`);
    }
  }

  await page.getByRole("button", { name: "+ Profile" }).click();
  await page.getByPlaceholder("Name").fill("E2E Dup");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByLabel("Active profile")).toContainText("E2E Dup");

  // Adding the same name again must be rejected, not duplicated.
  await page.getByRole("button", { name: "+ Profile" }).click();
  await page.getByPlaceholder("Name").fill("E2E Dup");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("A profile with that name already exists")).toBeVisible();

  const res = await page.request.get("/api/profiles");
  const matches = (await res.json()).filter((p: { name: string }) => p.name === "E2E Dup");
  expect(matches).toHaveLength(1);

  // Clean up so the next run starts from a known state.
  for (const profile of matches) {
    await page.request.delete(`/api/profiles/${profile.id}`);
  }
});
