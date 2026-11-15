import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import {
  INACTIVE_PROFILE_RETENTION_MS,
  PERSONAL_DATA_ROWS,
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

/** A recording stand-in for the Prisma client: no database involved. */
function fakePrisma(fixture: Record<string, unknown>) {
  const calls: { delegate: string; method: string; args?: unknown }[] = [];
  const client = new Proxy(
    {},
    {
      get(_target, delegate: string) {
        if (delegate === "$transaction") {
          return async (ops: Promise<unknown>[]) => Promise.all(ops);
        }
        return new Proxy(
          {},
          {
            get(_d, method: string) {
              return async (args?: unknown) => {
                calls.push({ delegate, method, args });
                if (method === "findUnique") return fixture.profile ?? null;
                if (method === "findMany") return fixture[delegate] ?? [];
                return undefined;
              };
            },
          },
        );
      },
    },
  );
  return { client: client as unknown as PrismaClient, calls };
}

const exportSelects: Record<string, unknown> = {
  profile: { id: true, name: true, color: true, role: true, createdAt: true, followsServerLibrary: true, ageBand: true },
  session: { id: true, expiresAt: true, userAgent: true, deviceLabel: true, deviceCredentialId: true, createdAt: true },
  listeningHistory: { id: true, mediaItemId: true, position: true, completed: true, lastPlayed: true, playedAt: true },
  playSession: { id: true, mediaItemId: true, startedAt: true, endedAt: true, fromPosition: true, toPosition: true, speed: true },
  favourite: { mediaItemId: true, createdAt: true },
  wishlistItem: { id: true, title: true, author: true, seedMediaItemId: true, owned: true, createdAt: true },
  profileLibraryEntry: { mediaItemId: true },
  deviceCredential: { label: true, deviceId: true, createdAt: true },
  webAuthnCredential: { credentialId: true, publicKey: true, counter: true, createdAt: true },
  webAuthnChallenge: { id: true, type: true, expiresAt: true, createdAt: true },
  oAuthHandoff: { id: true, createdAt: true, expiresAt: true, consumedAt: true },
};

describe("the personal-data tables (spec 37 step 6.1)", () => {
  it("lists every table that holds personal data", () => {
    // The one list the export, erasure and retention purge all read. Ordered
    // children-before-profile so a delete can run without FK violations.
    expect([...PROFILE_PERSONAL_DATA_MODELS]).toEqual([
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

describe("the declarative table drives the executors (spec 41 phase 5)", () => {
  it("the model list is derived from the rows, not duplicated", () => {
    expect([...PROFILE_PERSONAL_DATA_MODELS]).toEqual(PERSONAL_DATA_ROWS.map((row) => row.model));
  });

  it("every row declares an erase strategy and a select", () => {
    for (const row of PERSONAL_DATA_ROWS) {
      expect(["deleteMany", "delete"]).toContain(row.erase);
      expect(Object.keys(row.select).length).toBeGreaterThan(0);
      for (const value of Object.values(row.select)) {
        expect(value).toBe(true);
      }
    }
  });

  it("only the profile row deletes by id; everything else deletes by profileId", () => {
    for (const row of PERSONAL_DATA_ROWS) {
      expect(row.erase).toBe(row.model === "profile" ? "delete" : "deleteMany");
      expect(row.find).toBe(row.model === "profile" ? "unique" : "many");
    }
  });

  it("export reads exactly the declared selects and keys", async () => {
    const fixture = Object.fromEntries(
      PERSONAL_DATA_ROWS.map((row) => [
        row.model,
        row.find === "unique" ? { id: 7, name: "Sam" } : [{ id: 1 }],
      ]),
    );
    const { client, calls } = fakePrisma(fixture);
    const exported = await exportProfilePersonalData(client, 7);

    expect(exported).not.toBeNull();
    expect(Object.keys(exported!).sort()).toEqual(
      ["exportedAt", ...PERSONAL_DATA_ROWS.map((row) => row.key)].sort(),
    );
    for (const row of PERSONAL_DATA_ROWS) {
      const call = calls.find((c) => c.delegate === row.model);
      expect(call, `no export call recorded for ${row.model}`).toBeDefined();
      expect(call!.method).toBe(row.find === "unique" ? "findUnique" : "findMany");
      expect((call!.args as { select: unknown }).select).toEqual(exportSelects[row.model]);
    }
  });

  it("export returns null when the profile is gone", async () => {
    const { client } = fakePrisma({});
    expect(await exportProfilePersonalData(client, 7)).toBeNull();
  });

  it("erasure deletes every declared row in table order inside one transaction", async () => {
    const { client, calls } = fakePrisma({});
    await eraseProfilePersonalData(client, 7);

    expect(calls.map((c) => c.delegate)).toEqual(PERSONAL_DATA_ROWS.map((row) => row.model));
    for (const call of calls) {
      if (call.delegate === "profile") {
        expect(call.method).toBe("delete");
        expect(call.args).toEqual({ where: { id: 7 } });
      } else {
        expect(call.method).toBe("deleteMany");
        expect(call.args).toEqual({ where: { profileId: 7 } });
      }
    }
  });

  it("retention purge drives erasure per inactive profile", async () => {
    const { client, calls } = fakePrisma({
      profile: [{ id: 3 }, { id: 4 }],
    });
    await purgeInactiveProfiles(client, new Date("2026-11-15T00:00:00.000Z"));
    const erased = calls.filter((c) => c.method === "deleteMany" || c.method === "delete");
    expect(erased.filter((c) => c.delegate === "profile")).toHaveLength(2);
  });
});

describe("the personal-data list is complete (spec 37 step 6.2; guard widened in spec 41)", () => {
  it("covers every Prisma model with a profileId relation", () => {
    const inSchema = prismaModelsWithProfileId().map(modelToDelegate).sort();
    const inList = [...PROFILE_PERSONAL_DATA_MODELS].filter((name) => name !== "profile").sort();
    expect(inList).toEqual(inSchema);
  });

  it("every schema model with a profileId relation has a full row, not just a mention", () => {
    const inSchema = prismaModelsWithProfileId().map(modelToDelegate);
    for (const delegate of inSchema) {
      const row = PERSONAL_DATA_ROWS.find((r) => r.model === delegate);
      expect(row, `no personal-data row for schema model ${delegate}`).toBeDefined();
      expect(row!.erase).toBe("deleteMany");
      expect(Object.keys(row!.select).length).toBeGreaterThan(0);
    }
  });
});
