import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:5173";

export default defineConfig({
  testDir: "./e2e",
  // Real audio playback and library scans do not fit in 30s.
  timeout: 90_000,
  expect: { timeout: 10_000 },
  // One shared server, one SQLite database and one shared library: parallel
  // workers would race on library roots, scans and progress rows.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 1,
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // Fail loudly on a missing server, missing fixtures or a password mismatch
  // instead of letting every test skip into a vacuous green run.
  globalSetup: "./e2e/global-setup.ts",
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], serviceWorkers: "block" },
      testIgnore: /security\/.*/,
    },
    {
      name: "security",
      use: { ...devices["Desktop Chrome"], serviceWorkers: "block" },
      testMatch: /security\/.*/,
    },
  ],
});
