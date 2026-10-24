import { test, expect } from "@playwright/test";
import { deleteProfiles, ensureAuthed, login, pickAnyProfile } from "./helpers";

test("login gate blocks, then allows, profile creation", async ({ page }) => {
  await page.goto("/");
  // The normal gate is the profile picker; the household key is the recovery
  // mode these setup tests use.
  await page.getByRole("button", { name: "Use the household password" }).click();
  await expect(page.getByPlaceholder("Household password")).toBeVisible();

  await page.getByPlaceholder("Household password").fill("wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("That password doesn't match. Try again.")).toBeVisible();

  await login(page);

  // Purge profiles this test created on earlier runs so the library does not
  // accumulate one per run. A *unique* name is used below, so a leftover can
  // never turn the create into a false duplicate.
  await deleteProfiles(page, (profile) => profile.name.startsWith("E2E User "));
  const name = `E2E User ${Date.now().toString(36)}`;

  // No profile selected yet: the profile gate appears. Creating a
  // profile through it also selects it and enters the app.
  await expect(page.getByRole("heading", { name: "Who's listening?" })).toBeVisible();
  await page.getByRole("button", { name: "+ Add profile" }).click();
  await page.getByPlaceholder("Name").fill(name);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  // "Audiobook Manager" is also the login gate's heading, so assert something
  // only the signed-in library renders.
  await expect(page.getByRole("heading", { name: "Your audiobooks" })).toBeVisible();
  await expect(page.getByLabel("Active profile").locator("option:checked")).toHaveText(name);

  // The profile really exists server-side, exactly once.
  await ensureAuthed(page);
  const created = await (await page.request.get("/api/profiles")).json();
  expect(created.filter((profile: { name: string }) => profile.name === name)).toHaveLength(1);

  await deleteProfiles(page, (profile) => profile.name === name);
});

test("duplicate profile names are rejected", async ({ page }) => {
  await page.goto("/");
  await login(page);
  await pickAnyProfile(page);

  await deleteProfiles(page, (profile) => profile.name.startsWith("E2E Dup "));
  const name = `E2E Dup ${Date.now().toString(36)}`;

  await page.getByRole("button", { name: "+ Profile" }).click();
  await page.getByPlaceholder("Name").fill(name);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  // Assert the *selected* option. toContainText on the <select> would match
  // any <option> and pass even if a different profile were active.
  await expect(page.getByLabel("Active profile").locator("option:checked")).toHaveText(name);

  // Adding the same name again must be rejected, not duplicated.
  await page.getByRole("button", { name: "+ Profile" }).click();
  await page.getByPlaceholder("Name").fill(name);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("A profile with that name already exists")).toBeVisible();

  await ensureAuthed(page);
  const res = await page.request.get("/api/profiles");
  const matches = (await res.json()).filter((p: { name: string }) => p.name === name);
  expect(matches).toHaveLength(1);

  // Clean up so the next run starts from a known state.
  await deleteProfiles(page, (profile) => profile.name === name);
});
