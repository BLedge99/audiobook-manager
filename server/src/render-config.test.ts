import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Spec 45, phase 3 — the blueprint is the source of truth for the demo
 * deploy (spec 43 phase 4.1). The 2026-11-17 re-audit found it started the
 * server without `prisma migrate deploy`, while a migration landed that
 * nothing would apply; and no Node version anywhere in it, while both tiers
 * declare `engines: node >= 24`.
 */

const blueprint = readFileSync(path.resolve(__dirname, "../../render.yaml"), "utf8");

describe("render.yaml", () => {
  it("applies committed migrations before the server starts", () => {
    const start = blueprint.match(/startCommand:\s*(.+)\n/);
    expect(start?.[1]).toMatch(/db:prod:migrate/);
    expect(start?.[1]?.indexOf("db:prod:migrate")).toBeLessThan(
      start?.[1]?.indexOf("run start") ?? Number.POSITIVE_INFINITY,
    );
  });

  it("pins the Node major its engines demand", () => {
    expect(blueprint).toMatch(/- key: NODE_VERSION\s*\n\s+value: "24"/);
  });

  it("carries no plaintext secret value (every secret is sync:false)", () => {
    const secretKeys = ["APP_PASSWORD", "MEDIA_TOKEN_SECRET", "ADMIN_PANEL_PASSWORD", "DATABASE_URL"];
    for (const key of secretKeys) {
      const row = new RegExp(`- key: ${key}\\s*\\n\\s+sync: false`);
      expect(blueprint).toMatch(row);
    }
  });
});
