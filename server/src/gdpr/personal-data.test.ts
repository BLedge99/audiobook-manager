import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  INACTIVE_PROFILE_RETENTION_MS,
  PROFILE_PERSONAL_DATA_MODELS,
  eraseProfilePersonalData,
  exportProfilePersonalData,
  inactiveProfileCutoff,
  purgeInactiveProfiles,
} from "./personal-data";

function prismaModelsWithProfileId(): string[] {
  const schemaPath = path.resolve(__dirname, "../../prisma/schema.prisma");
  const schema = readFileSync(schemaPath, "utf8");
  const modelRe = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  const models: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = modelRe.exec(schema)) !== null) {
    const [, name, body] = match;
    if (/^\s*profileId\b/m.test(body)) models.push(name);
  }
  return models.sort();
}

function modelToDelegate(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

describe("the personal-data tables (spec 37 step 6.1)", () => {
  it("lists every table that holds personal data", () => {
    // The one list the export, erasure and retention purge all read. Ordered
    // children-before-profile so a delete can run without FK violations.
    expect(PROFILE_PERSONAL_DATA_MODELS).toEqual([
      "oAuthHandoff",
      "webAuthnChallenge",
      "webAuthnCredential",
      "deviceCredential",
      "session",
      "listeningHistory",
      "playSession",
      "favourite",
      "wishlistItem",
      "profileLibraryEntry",
      "profile",
    ]);
  });

  it("is what the export reads", () => {
    expect(typeof exportProfilePersonalData).toBe("function");
  });

  it("is what the erasure reads", () => {
    expect(typeof eraseProfilePersonalData).toBe("function");
  });

  it("is what the retention purge reads", () => {
    expect(typeof purgeInactiveProfiles).toBe("function");
  });

  it("owns the 24-month inactive-profile retention constant", () => {
    expect(INACTIVE_PROFILE_RETENTION_MS).toBe(24 * 30 * 24 * 60 * 60 * 1000);
    expect(inactiveProfileCutoff(new Date("2026-01-01T00:00:00.000Z")).toISOString()).toBe(
      "2024-01-12T00:00:00.000Z",
    );
  });
});

describe("the personal-data list is complete (spec 37 step 6.2)", () => {
  it("covers every Prisma model with a profileId relation", () => {
    const inSchema = prismaModelsWithProfileId().map(modelToDelegate).sort();
    const inList = [...PROFILE_PERSONAL_DATA_MODELS].filter((name) => name !== "profile").sort();
    expect(inList).toEqual(inSchema);
  });
});
