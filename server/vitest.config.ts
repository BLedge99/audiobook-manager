import { defineConfig } from "vitest/config";

// Vitest 4 no longer excludes `dist` from its default search. `npm run build`
// compiles the co-located `*.test.ts` files into CommonJS under `dist/`, so a
// later `npm test` would try to run them, fail on `require("vitest")`, and
// exit non-zero even though every real test passed. Restrict the suite to the
// source tree so a build can never change what the tests are.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**"],
  },
});
