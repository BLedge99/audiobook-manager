/*
 * Design-lab capture harness (Phase 0 of the GUI-evolution experiment).
 *
 * Forked from scripts/capture-ui.js with three deliberate changes:
 *   1. Sign-in handles BOTH stack auth modes: if the household password gate
 *      is showing it signs in with CAPTURE_PASS; if the API is running with
 *      auth off (the WSL dev stack) the app boots straight to the profile
 *      picker, and we pick CAPTURE_PROFILE instead. The old script hung for
 *      30s and then for the rest of the process lifetime on this stack.
 *   2. Browser close is in a finally block, so a failure cannot leave a
 *      chromium process holding the node event loop open.
 *   3. Every capture also writes a manifest.json (git sha, surfaces, guard
 *      results) so generations can be reconstructed from the gallery alone.
 *
 * The layout guards are duplicated, not shared, on purpose: capture-ui.js is
 * the documented review path (DESIGN.md) and must stay stable, while this
 * script will gain surfaces as the lab widens.
 *
 * Usage:
 *   node scripts/design-lab-capture.js <gen-id>
 *   node scripts/design-lab-capture.js gen-0
 *
 * Env:
 *   CAPTURE_URL      client origin      (default http://127.0.0.1:5173)
 *   CAPTURE_PASS     household password (default household)
 *   CAPTURE_PROFILE  profile to pick    (default admin — seeded, passwordless)
 *   CAPTURE_OUT      output override    (default docs/design-lab/<gen-id>)
 */
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");
const { chromium } = require("playwright");

const GEN = process.argv[2];
if (!GEN) {
  console.error("usage: node scripts/design-lab-capture.js <gen-id>   (e.g. gen-0)");
  process.exit(2);
}

const TARGET = process.env.CAPTURE_URL || "http://127.0.0.1:5173";
// A seeded, password-less profile: deterministic first-listed fixture profile.
// Ben's profile has a password and is never used for lab captures.
const PROFILE = process.env.CAPTURE_PROFILE || "admin";
const OUT = process.env.CAPTURE_OUT || path.join("docs", "design-lab", GEN);

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

const setTheme = async (page, theme) => {
  await page.evaluate((value) => {
    localStorage.setItem("bookle-theme", value);
    document.documentElement.setAttribute("data-theme", value);
  }, theme);
  await page.waitForTimeout(400);
};

const findOverflow = async (page) =>
  page.evaluate(() => {
    const doc = document.documentElement;
    const vw = doc.clientWidth;
    const offenders = [];
    for (const el of document.querySelectorAll("*")) {
      const rect = el.getBoundingClientRect();
      const boxWide = rect.right > vw + 1 || rect.left < -1;
      const contentWide = el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0;
      if (!boxWide && !contentWide) continue;
      if (rect.width === 0 && rect.height === 0 && !contentWide) continue;
      if (getComputedStyle(el).clipPath === "rect(0px, 0px, 0px, 0px)") continue;
      offenders.push(
        `${el.tagName.toLowerCase()}.${(el.getAttribute("class") || "").trim().split(/\s+/).slice(0, 4).join(".")}` +
          ` right=${Math.round(rect.right)} sw=${el.scrollWidth} cw=${el.clientWidth}`,
      );
    }
    return { viewport: vw, scrollWidth: doc.scrollWidth, offenders: offenders.slice(0, 8) };
  });

const findLeakedComments = async (page) =>
  page.evaluate(() => {
    const text = document.body.innerText || "";
    const hits = [];
    if (text.includes("/*") || text.includes("*/")) hits.push("block comment rendered as visible text");
    if (/\bTODO\b|\bFIXME\b|\bXXX\b/.test(text)) hits.push("TODO/FIXME visible on screen");
    return hits;
  });

/** Spec-28 gate flow: the default gate is the profile picker with a
 *  "Use the household password" recovery link; a deployment with the recovery
 *  disabled shows the household form directly. Either is a valid entry. */
async function enterApp(page, failures) {
  const PASS = process.env.CAPTURE_PASS || "household";
  console.log(`[lab] opening ${TARGET}`);
  await page.goto(TARGET);

  const direct = page.getByPlaceholder("Household password");
  const recovery = page.getByRole("button", { name: "Use the household password" });
  try {
    await page.waitForFunction(
      () => document.body && document.body.innerText.length > 0,
      undefined,
      { timeout: 5000 },
    ).catch(() => undefined);
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (await direct.isVisible().catch(() => false)) break;
      if (await recovery.isVisible().catch(() => false)) {
        console.log("[lab] profile picker is the gate; using household recovery");
        await recovery.click();
        break;
      }
      if (attempt === 59) throw new Error("gate never appeared");
      await page.waitForTimeout(500);
    }
    await direct.fill(PASS);
    await page.getByRole("button", { name: "Sign in" }).click();
    console.log("[lab] signed in through the household gate");
  } catch (error) {
    failures.push(`household sign-in failed: ${error.message}`);
    await page.screenshot({ path: path.join(OUT, "FAILED-entry.png") });
    return false;
  }

  const profileButton = page.getByRole("button", { name: PROFILE, exact: true });
  try {
    await profileButton.waitFor({ timeout: 15_000 });
    await profileButton.click();
    console.log(`[lab] picked profile ${PROFILE}`);
  } catch {
    failures.push(`profile "${PROFILE}" never appeared after sign-in`);
    await page.screenshot({ path: path.join(OUT, "FAILED-profile.png") });
    return false;
  }

  try {
    await page.getByRole("heading", { name: /your audiobooks/i }).first().waitFor({ timeout: 30_000 });
  } catch {
    failures.push("library heading never appeared after entry");
    await page.screenshot({ path: path.join(OUT, "FAILED-library.png") });
    return false;
  }
  await page.waitForTimeout(1400); // let the dispense entrance settle
  return true;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const failures = [];
  const browser = await chromium.launch();
  const manifest = {
    gen: GEN,
    capturedAt: new Date().toISOString(),
    url: TARGET,
    gitSha: execSync("git rev-parse HEAD").toString().trim(),
    gitBranch: execSync("git branch --show-current").toString().trim(),
    surfaces: [],
    guards: {},
    failures: [],
  };

  const shot = async (page, name) => {
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    manifest.surfaces.push(name);
  };

  try {
    const page = await browser.newPage({ viewport: PHONE, serviceWorkers: "block" });
    if (!(await enterApp(page, failures))) throw new Error("entry failed; see FAILED-*.png");
    const nav = page.getByRole("navigation", { name: "Sections" });

    // --- phone, light ----------------------------------------------------
    await setTheme(page, "light");
    await shot(page, "phone-library-light");

    const overflow = await findOverflow(page);
    if (overflow.scrollWidth > overflow.viewport + 1) {
      failures.push(
        `phone library scrolls sideways: ${overflow.scrollWidth} > ${overflow.viewport}\n    ${overflow.offenders.join("\n    ")}`,
      );
    }
    for (const leak of await findLeakedComments(page)) failures.push(`phone library: ${leak}`);

    await page.locator("article[data-book-id]").first().click();
    await page.waitForTimeout(900);
    await shot(page, "phone-detail-light");
    const inner = await page
      .locator("div.fixed.inset-0 > article")
      .first()
      .evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }))
      .catch(() => null);
    if (inner && inner.scrollWidth > inner.clientWidth + 1) {
      failures.push(`detail dialog scrolls sideways: ${inner.scrollWidth} inside ${inner.clientWidth}`);
    }
    await page.getByLabel("Close details").click().catch(() => failures.push("detail: close control not found"));
    await page.waitForTimeout(400);

    await nav.getByRole("button", { name: "Browse" }).click();
    await page.waitForTimeout(900);
    await shot(page, "phone-browse-light");

    // --- phone, dark -----------------------------------------------------
    await nav.getByRole("button", { name: "Library" }).click();
    await page.waitForTimeout(400);
    await setTheme(page, "dark");
    await shot(page, "phone-library-dark");
    await nav.getByRole("button", { name: "Browse" }).click();
    await page.waitForTimeout(900);
    await shot(page, "phone-browse-dark");

    // --- desktop ---------------------------------------------------------
    await page.setViewportSize(DESKTOP);
    await nav.getByRole("button", { name: "Library" }).click();
    await page.waitForTimeout(700);
    await setTheme(page, "light");
    await page.screenshot({ path: path.join(OUT, "desktop-library-light.png"), fullPage: true });
    manifest.surfaces.push("desktop-library-light");
    await setTheme(page, "dark");
    await page.screenshot({ path: path.join(OUT, "desktop-library-dark.png"), fullPage: true });
    manifest.surfaces.push("desktop-library-dark");

    const wideOverflow = await findOverflow(page);
    if (wideOverflow.scrollWidth > wideOverflow.viewport + 1) {
      failures.push(`desktop scrolls sideways: ${wideOverflow.scrollWidth} > ${wideOverflow.viewport}`);
    }
    for (const leak of await findLeakedComments(page)) failures.push(`desktop library: ${leak}`);
  } catch (error) {
    failures.push(String(error && error.message ? error.message : error));
  } finally {
    await browser.close();
  }

  manifest.guards = { layout: failures.length === 0 };
  manifest.failures = failures;
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));

  if (failures.length) {
    console.error("LAYOUT/ENTRY GUARDS FAILED:\n  - " + failures.join("\n  - "));
    process.exitCode = 1;
    return;
  }
  console.log(`[lab] captured ${manifest.surfaces.length} surfaces to ${OUT} — guards pass.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
