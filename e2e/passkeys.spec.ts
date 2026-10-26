import { expect, test, type Page } from "@playwright/test";
import { deleteProfiles, login } from "./helpers";

const PASSWORD = "correct-horse-9";
const PROFILE = `E2E Passkey ${Date.now().toString(36)}`;

/**
 * Spec 28, phase 6: a virtual authenticator is the only way to exercise
 * Windows Hello in CI. Chrome's virtual authenticator lives behind CDP, so the
 * ceremony really runs through `navigator.credentials` and the real server
 * verification -- it is not a mocked WebAuthn call.
 */
async function addVirtualAuthenticator(page: Page) {
  const session = await page.context().newCDPSession(page);
  await session.send("WebAuthn.enable", { enableUI: false });
  const { authenticatorId } = await session.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { session, authenticatorId };
}

async function signInWithPassword(page: Page, name: string) {
  await page.goto("/");
  await page.getByRole("button", { name, exact: true }).click();
  await page.getByPlaceholder("Profile password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Your audiobooks" })).toBeVisible();
}

test.describe("web passkeys", () => {
  test("registers Windows Hello and signs in with it", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    await login(page);
    await deleteProfiles(page, (profile) => profile.name === PROFILE);

    const created = await page.request.post("/api/profiles", { data: { name: PROFILE } });
    expect(created.status()).toBe(201);
    const profile = (await created.json()) as { id: number };

    const reset = await page.request.post(`/api/auth/accounts/${profile.id}/reset`, {
      data: { newPassword: PASSWORD },
    });
    expect(reset.ok()).toBe(true);

    // Leave the household session: passkeys are attached to a profile.
    await page.request.post("/api/auth/logout");
    await signInWithPassword(page, PROFILE);

    const { session } = await addVirtualAuthenticator(page);

    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Add Windows Hello" }).click();
    await expect(page.getByText("Windows Hello is ready for this profile.")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("Windows Hello", { exact: true })).toBeVisible();

    // Sign out, then use the passkey instead of the password.
    await page.request.post("/api/auth/logout");
    await page.goto("/");
    await page.getByRole("button", { name: PROFILE, exact: true }).click();
    const passkeyButton = page.getByRole("button", { name: "Sign in with Windows Hello" });
    await expect(passkeyButton).toBeVisible();
    await passkeyButton.click();
    await expect(page.getByRole("heading", { name: "Your audiobooks" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("heading", { name: "Who's listening?" })).toHaveCount(0);

    await session.detach();

    // Cleanup needs the admin break-glass session again; the passkey session
    // belongs to a member and cannot delete profiles.
    await page.request.post("/api/auth/logout");
    await page.goto("/");
    await login(page);
    await deleteProfiles(page, (candidate) => candidate.name === PROFILE);
  });
});
