import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression guard for the admin panel build entry.
 *
 * `vite.admin.config.ts` sets Vite's root to `client/admin`, and its alias maps
 * `/src` onto `client/src`. So the entry script in `client/admin/index.html`
 * must therefore name the admin app itself — `/src/admin/main.tsx` — and not the
 * family shell's `/src/main.tsx`. A bare `/src/main.tsx` silently resolves through
 * the alias to the *family* entry, and the admin panel ships the family app:
 * its styles, its screens, and its API calls (`/api/auth/...` instead of
 * `/api/admin/...`) — which is how the panel came up "broken" with 404s on every
 * admin call and an unstyled, wrong-looking page.
 *
 * See spec 31 / ADR 022; this is build wiring, so it lives here rather than in
 * the components.
 */
describe("the admin panel build entry", () => {
  it("loads the admin app, not the family shell", () => {
    const html = readFileSync(resolve(__dirname, "../../admin/index.html"), "utf8");
    expect(html).toContain('src="/src/admin/main.tsx"');
  });
});
