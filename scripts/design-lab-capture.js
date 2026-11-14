/*
 * Design-lab capture harness (Phase 0 of the GUI-evolution experiment).
 *
 * Forked from scripts/capture-ui.js with deliberate changes:
 *   1. Sign-in follows the spec-28 gate: the app boots to the profile picker;
 *      the harness picks the lab profile and fills the profile password if it
 *      is asked. The lab profile is a throwaway "design-lab" account created
 *      for captures only (creds in .impeccable/design-lab-creds.json, never
 *      committed). The household password is never involved.
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
 *   CAPTURE_URL       client origin (default http://127.0.0.1:5173)
 *   CAPTURE_PROFILE_PASSWORD  lab profile password (default: read from .impeccable/design-lab-creds.json)
 *   CAPTURE_PROFILE           lab profile        (default design-lab)
 *   CAPTURE_OUT       output override    (default docs/design-lab/<gen-id>)
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
// The lab's throwaway capture profile — never a household member's profile.
const PROFILE = process.env.CAPTURE_PROFILE || "design-lab";
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

/** Spec-28 default gate: the app boots to the profile picker. Picks the lab
 *  profile and, if it asks, fills the profile password. The credentials file
 *  is gitignored (.impeccable/design-lab-creds.json); env wins if set. */
async function enterApp(page, failures, shot) {
  const fsPath = path.join(".impeccable", "design-lab-creds.json");
  let profilePass = process.env.CAPTURE_PROFILE_PASSWORD;
  if (!profilePass) {
    try {
      profilePass = JSON.parse(fs.readFileSync(fsPath, "utf8")).password;
    } catch {
      // passwordless profile, or none configured; the sign-in step will tell us
    }
  }
  console.log(`[lab] opening ${TARGET}`);
  // domcontentloaded, not load: the relay plus a cold dev server can push the
  // load event past any sane deadline; the gate is readiness-polled anyway.
  await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 60_000 });

  // The spec-28 default gate is the profile picker — the lab's glow/select
  // material lives on its capsules, so document it before signing in. Wait for
  // the buttons to render (the API fetch lags the heading) or the shot lands
  // on the bare "Checking…" state.
  try {
    await page.getByRole("heading", { name: "Who's listening?" }).waitFor({ timeout: 90_000 });
    await page.locator(".capsule--select").first().waitFor({ state: "visible", timeout: 90_000 });
    await shot(page, "gate-phone-light");
    await setTheme(page, "dark");
    await page.waitForTimeout(600);
    await shot(page, "gate-phone-dark");
    await setTheme(page, "light");
    await page.waitForTimeout(400);
  } catch (error) {
    failures.push(`gate capture skipped: ${error.message}`);
    await page.screenshot({ path: path.join(OUT, "FAILED-gate.png") }).catch(() => undefined);
  }

  // The app takes ~20-45s to finish bootstrapping (per-profile probes fly
  // sequentially through the dev relay). Poll instead of a fixed wait.
  const profileButton = page.getByRole("button", { name: new RegExp("^" + PROFILE + "(\\b|$)") });
  try {
    for (let attempt = 0; attempt < 90; attempt += 1) {
      if (await profileButton.isVisible().catch(() => false)) break;
      if (attempt === 89) throw new Error("profile picker never rendered within 90s");
      await page.waitForTimeout(1000);
    }
    await profileButton.click();
    console.log(`[lab] picked profile ${PROFILE}`);
    const passwordBox = page.getByPlaceholder("Profile password");
    try {
      await passwordBox.waitFor({ timeout: 20_000 });
      if (!profilePass) throw new Error("profile password required but none provided");
      await passwordBox.fill(profilePass);
      await page.getByRole("button", { name: /sign in/i }).first().click();
      console.log("[lab] profile password accepted, signing in");
    } catch (error) {
      if (/password required/.test(String(error.message))) throw error;
      // No password prompt — this profile signs in directly.
    }
  } catch (error) {
    failures.push(`profile entry failed: ${error.message}`);
    await page.screenshot({ path: path.join(OUT, "FAILED-entry.png") });
    return false;
  }

  try {
    await page.getByRole("heading", { name: /your audiobooks/i }).first().waitFor({ timeout: 90_000 });
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

  const shot = async (page, name, options = {}) => {
    // Playwright screenshot writes fail transiently under on-access AV scans;
    // one bad write must not discard a whole generation.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        await page.screenshot({ path: path.join(OUT, `${name}.png`), ...options });
        break;
      } catch (error) {
        if (attempt === 3) throw error;
        await page.waitForTimeout(1500);
      }
    }
    manifest.surfaces.push(name);
  };

  try {
    const page = await browser.newPage({ viewport: PHONE, serviceWorkers: "block" });
    if (!(await enterApp(page, failures, shot))) throw new Error("entry failed; see FAILED-*.png");
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
    await shot(page, "desktop-library-light", { fullPage: true });
    await setTheme(page, "dark");
    await shot(page, "desktop-library-dark", { fullPage: true });

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
