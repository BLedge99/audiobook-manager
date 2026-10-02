import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test("login gate blocks, then allows, profile creation", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByPlaceholder("Household password")).toBeVisible();

  await page.getByPlaceholder("Household password").fill("wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Incorrect password")).toBeVisible();

  await login(page);
  await expect(page.getByRole("heading", { name: "Audiobook Manager" })).toBeVisible();

  await page.getByRole("button", { name: "+ Profile" }).click();
  await page.getByPlaceholder("Name").fill("E2E User");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByLabel("Active profile")).toContainText("E2E User");
});
