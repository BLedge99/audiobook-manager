import { defineConfig } from "vitest/config";

// Vitest 4 no longer excludes `dist` from its default search. `npm run build`
// compiles the co-located `*.test.ts` files into CommonJS under `dist/`, so a
// later `npm test` would try to run them, fail on `require("vitest")`, and
// exit non-zero even though every real test passed. Restrict the suite to the
// source tree so a build can never change what the tests are.
//
// Disable loading .env files so tests can control DATABASE_URL themselves.
// Every test file points Prisma at its own SQLite database via
// `createTestDatabase()` (src/test-support/database.ts).
//
// The global setup generates the Prisma client for SQLite exactly once and
// builds a schema template from the SQLite migrations. Test files must not
// generate the client or run `db push` themselves: parallel workers would race
// on the shared generated client, and the suite's result would depend on which
// provider won last.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**"],
    envFile: false,
    globalSetup: ["./src/test-support/global-setup.ts"],
  },
});
