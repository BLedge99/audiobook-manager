/**
 * ESLint flat config (spec 43 phase 6.1).
 *
 * The point of this config is exactly two things and nothing more:
 *
 *   1. `react-hooks/exhaustive-deps` as an error — the class of stale-closure
 *      bugs this codebase has nine suppressed sites for, and the only lint
 *      rule with real defect-catching power here.
 *   2. TypeScript's own "unused" discipline already comes from tsc
 *      (noUnusedLocals/Parameters); this config does not duplicate it.
 *
 * No stylistic opinions, no import ordering rules, no anything the formatter
 * or the compiler already owns. If you are tempted to add a rule, check the
 * client test suite stays green without it first.
 */
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "admin-dist/**",
      "android/**",
      "dev-dist/**",
      "**/*.d.ts",
      "vite.config.ts",
      "public/theme-init.js",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",

      // The type system already covers these; keep the signal high.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      // `no-empty` allowances: intentional, commented empty catches are idiomatic here.
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Keep the bundle honest — a stray `debugger` must not ship.
      "no-debugger": "error",
    },
  },
  {
    files: ["**/*.test.{ts,tsx}", "test/**/*.{ts,tsx}"],
    rules: {
      "no-unused-expressions": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
);
