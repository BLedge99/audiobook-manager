/*
 * Capture the client UI for design review, against a running stack.
 *
 * Why this is a script and not a Playwright spec: the repo's `e2e/` suite is the
 * behavioural guard, and its `globalSetup` provisions its own fixtures, library
 * roots and password. Adding review captures there would make them race a dev
 * database, and would put screenshots inside a suite whose job is assertions.
 *
 * Usage:
 *   npm --prefix server run dev            # or make start
 *   npm --prefix client run dev
 *   node scripts/capture-ui.js
 *
 * Env:
 *   CAPTURE_URL   client origin      (default http://127.0.0.1:5173)
 *   CAPTURE_PASS  household password (default household)
 *   CAPTURE_OUT   output directory   (default .impeccable/review)
 *
 * One browser, one login, one page: the viewport is resized between captures
 * rather than opening a second context. Signing in twice meant two chances for
 * the cold dev server to leave a gate half-mounted, which read as an auth bug.
 *
 * It also re-asserts the two layout guards the redesign could plausibly break --
 * the document never scrolling sideways, and the book-detail dialog never
 * scrolling internally -- because a rotated, canted capsule is exactly the kind
 * of change that pushes a bounding box past the viewport edge.
 */
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const TARGET = process.env.CAPTURE_URL || "http://127.0.0.1:5173";
const PASSWORD = process.env.CAPTURE_PASS || "household";
const OUT = process.env.CAPTURE_OUT || ".impeccable/review";
/** Profile created by `npm --prefix server run seed:profiles`. */
const PROFILE = process.env.CAPTURE_PROFILE || "Ben";

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

function step(message) {
  console.log(`[capture] ${message}`);
}

async function setTheme(page, theme) {
  await page.evaluate((value) => {
    localStorage.setItem("bookle-theme", value);
    document.documentElement.setAttribute("data-theme", value);
  }, theme);
  await page.waitForTimeout(400);
}

async function findOverflow(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const vw = doc.clientWidth;
    const offenders = [];
    for (const el of document.querySelectorAll("*")) {
      const rect = el.getBoundingClientRect();
      const boxWide = rect.right > vw + 1 || rect.left < -1;
      const contentWide = el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0;
      if (!boxWide && !contentWide) continue;
      if (rect.width === 0 && rect.height === 0 && !contentWide) continue;
      // `sr-only` text is 1x1 and clipped, so it always reports content wider
      // than its box. Not an overflow a person can reach.
      if (getComputedStyle(el).clipPath === "rect(0px, 0px, 0px, 0px)") continue;
      offenders.push(
        `${el.tagName.toLowerCase()}.${(el.getAttribute("class") || "").trim().split(/\s+/).slice(0, 4).join(".")}` +
          ` right=${Math.round(rect.right)} sw=${el.scrollWidth} cw=${el.clientWidth}`,
      );
    }
    return { viewport: vw, scrollWidth: doc.scrollWidth, offenders: offenders.slice(0, 8) };
  });
}

/** Poll for the login gate rather than trusting a single waitFor: on a cold dev
 *  server the app spends seconds on the splash before the gate mounts. */
async function waitForGate(page) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await page.getByPlaceholder("Household password").isVisible().catch(() => false)) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

async function signIn(page) {
  step(`signing in at ${TARGET}`);
  await page.goto(TARGET);
  if (await waitForGate(page)) {
    await page.getByPlaceholder("Household password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
  } else {
    await page.screenshot({ path: path.join(OUT, "FAILED-no-login-gate.png") });
    throw new Error("The login gate never appeared; wrote FAILED-no-login-gate.png.");
  }
  await page.getByRole("heading", { name: "Who's listening?" }).waitFor();
  await page.getByRole("button", { name: PROFILE, exact: true }).click();
  // The library is fetched once at mount, before a profile exists, so progress
  // is absent until the next fetch and the dock would have nothing to show.
  // Reloading with the profile already stored is what happens when a listener
  // comes back to the app.
  await page.reload();
  await page.getByRole("heading", { name: /all audiobooks/i }).first().waitFor();
  await page.waitForTimeout(1400); // let the dispense entrance settle
  step("signed in");
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const failures = [];

  const page = await browser.newPage({ viewport: PHONE, serviceWorkers: "block" });
  await signIn(page);
  const nav = page.getByRole("navigation", { name: "Sections" });

  // --- phone, light ------------------------------------------------------
  await setTheme(page, "light");
  await page.screenshot({ path: path.join(OUT, "phone-library-light.png") });

  const overflow = await findOverflow(page);
  if (overflow.scrollWidth > overflow.viewport + 1) {
    failures.push(
      `phone library scrolls sideways: ${overflow.scrollWidth} > ${overflow.viewport}\n    ${overflow.offenders.join("\n    ")}`,
    );
  }

  await page.locator("article[data-book-id]").first().click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, "phone-detail-light.png") });
  const inner = await page
    .locator("div.fixed.inset-0 > article")
    .first()
    .evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  if (inner.scrollWidth > inner.clientWidth + 1) {
    failures.push(`detail dialog scrolls sideways: ${inner.scrollWidth} inside ${inner.clientWidth}`);
  }
  await page.getByLabel("Close details").click();
  await page.waitForTimeout(400);

  await nav.getByRole("button", { name: "Browse" }).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, "phone-browse-light.png") });

  await nav.getByRole("button", { name: "Favourites" }).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, "phone-favourites-light.png") });

  // --- phone, dark -------------------------------------------------------
  await nav.getByRole("button", { name: "Library" }).click();
  await page.waitForTimeout(400);
  await setTheme(page, "dark");
  await page.screenshot({ path: path.join(OUT, "phone-library-dark.png") });
  await nav.getByRole("button", { name: "Browse" }).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, "phone-browse-dark.png") });

  // --- desktop -----------------------------------------------------------
  step("desktop");
  await page.setViewportSize(DESKTOP);
  await nav.getByRole("button", { name: "Library" }).click();
  await page.waitForTimeout(700);
  await setTheme(page, "light");
  await page.screenshot({ path: path.join(OUT, "desktop-library-light.png"), fullPage: true });
  await setTheme(page, "dark");
  await page.screenshot({ path: path.join(OUT, "desktop-library-dark.png"), fullPage: true });

  const wideOverflow = await findOverflow(page);
  if (wideOverflow.scrollWidth > wideOverflow.viewport + 1) {
    failures.push(`desktop scrolls sideways: ${wideOverflow.scrollWidth} > ${wideOverflow.viewport}`);
  }

  await browser.close();

  if (failures.length) {
    console.error("LAYOUT GUARDS FAILED:\n  - " + failures.join("\n  - "));
    process.exitCode = 1;
    return;
  }
  console.log(`Captured to ${OUT} — layout guards pass.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});