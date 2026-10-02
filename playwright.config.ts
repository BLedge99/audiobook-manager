import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:5173";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  use: { baseURL: BASE_URL, trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: /security\/.*/ },
    { name: "security", use: { ...devices["Desktop Chrome"] }, testMatch: /security\/.*/ },
  ],
});
