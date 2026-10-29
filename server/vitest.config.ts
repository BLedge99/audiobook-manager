import { defineConfig } from "vitest/config";

// Vitest 4 no longer excludes `dist` from its default search. `npm run build`
// compiles the co-located `*.test.ts` files into CommonJS under `dist/`, so a
// later `npm test` would try to run them, fail on `require("vitest")`, and
// exit non-zero even though every real test passed. Restrict the suite to the
// source tree so a build can never change what the tests are.
//
// Disable loading .env files so tests can control DATABASE_URL themselves.
// In CI, GitHub Actions sets DATABASE_URL as an environment variable.
// Locally, each test file creates its own temp SQLite database.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**"],
    envFile: false,
  },
});
