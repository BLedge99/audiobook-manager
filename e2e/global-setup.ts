import fs from "node:fs";
import path from "node:path";
import { request } from "@playwright/test";
import { E2E_PASSWORD, E2E_API_URL, E2E_BASE_URL } from "./helpers";

/**
 * Fail the whole run with an actionable message when the environment cannot
 * possibly support the suite.
 *
 * Without this, missing prerequisites turn into *green* runs: a library that
 * was never scanned makes every resume test skip, and an unset APP_PASSWORD
 * makes the security tests assert against a different server contract. A
 * vacuous pass is worse than a loud failure.
 */
export default async function globalSetup(): Promise<void> {
  const problems: string[] = [];

  // 1. The real media fixtures must exist.
  const fixtures = path.resolve(__dirname, "..", "test");
  let hasMedia = false;
  try {
    hasMedia = fs.readdirSync(fixtures).some((entry) =>
      fs.statSync(path.join(fixtures, entry)).isDirectory());
  } catch {
    problems.push(`No media fixtures at ${fixtures}. LibriVox sample libraries are required.`);
  }

  // 2. Both servers must be reachable.
  const api = await request.newContext();
  try {
    const health = await api.get(`${E2E_API_URL}/api/health`);
    if (!health.ok()) problems.push(`${E2E_API_URL}/api/health returned ${health.status()}.`);
  } catch {
    problems.push(`Server not reachable at ${E2E_API_URL}. Start it (make start, or npm --prefix server run dev).`);
  } finally {
    await api.dispose();
  }

  const browser = await request.newContext();
  try {
    const app = await browser.get(E2E_BASE_URL);
    if (!app.ok()) problems.push(`Client not reachable at ${E2E_BASE_URL}. Start it (npm --prefix client run dev).`);
  } catch {
    problems.push(`Client not reachable at ${E2E_BASE_URL}. Start it (npm --prefix client run dev).`);
  } finally {
    await browser.dispose();
  }

  // 3. Auth must be enabled with the password the suite expects, otherwise the
  //    401 assertions test nothing.
  if (problems.length === 0) {
    const ctx = await request.newContext();
    try {
      const login = await ctx.post(`${E2E_API_URL}/api/auth/login`, { data: { password: E2E_PASSWORD } });
      if (!login.ok()) {
        problems.push(`Login failed with the expected password. Set APP_PASSWORD=${E2E_PASSWORD} on the server (or E2E_APP_PASSWORD for the suite).`);
      }
    } catch {
      problems.push("Could not reach the login endpoint.");
    } finally {
      await ctx.dispose();
    }
  }

  if (hasMedia && problems.length === 0) return;
  if (!hasMedia && problems.length === 0) return;

  throw new Error(
    `E2E prerequisites are not met:\n  - ${problems.join("\n  - ")}\n\n` +
    "Run `make start` (or `npm --prefix server run dev` and `npm --prefix client run dev`) " +
    "with APP_PASSWORD set, and ensure the test/ fixture libraries are present.",
  );
}