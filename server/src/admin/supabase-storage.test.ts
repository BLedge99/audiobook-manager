import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import type { ScanManager } from "../scanner";
import {
  createSignedStorageUploadUrl,
  createSupabaseLibrarySync,
  storageObjectKey,
  supabaseStorageConfigFromEnv,
  type SupabaseStorageConfig,
} from "./supabase-storage";

vi.mock("../metadata/run", () => ({
  EnrichmentManager: class {
    constructor(_prisma: unknown) {}
    async enqueue() {}
  },
}));

const config: SupabaseStorageConfig = {
  url: "https://project.supabase.co",
  serviceRoleKey: "test-service-role-key",
  bucket: "audiobooks",
  cacheDir: "",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Supabase Storage configuration and paths", () => {
  it("does not enable storage unless all required values are present", () => {
    expect(supabaseStorageConfigFromEnv({})).toBeNull();
    expect(() => supabaseStorageConfigFromEnv({ SUPABASE_URL: "https://project.supabase.co" })).toThrow(
      "must be configured together",
    );
  });

  it("requires HTTPS outside localhost", () => {
    expect(() => supabaseStorageConfigFromEnv({
      SUPABASE_URL: "http://project.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "key",
      SUPABASE_STORAGE_BUCKET: "books",
    })).toThrow("must use HTTPS");
  });

  it("accepts only safe audio paths inside the books prefix", () => {
    expect(storageObjectKey("A Book", "01/Track 1.mp3")).toBe("books/A Book/01/Track 1.mp3");
    expect(storageObjectKey("../outside", "track.mp3")).toBeNull();
    expect(storageObjectKey("A Book", "%2e%2e/track.mp3")).toBeNull();
    expect(storageObjectKey("A Book", "track.txt")).toBeNull();
    expect(storageObjectKey("A Book", "..\\track.mp3")).toBeNull();
  });

  it("returns a signed URL without exposing anything beyond the URL", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        authorization: `Bearer ${config.serviceRoleKey}`,
        apikey: config.serviceRoleKey,
      });
      if (String(_input).includes("/bucket/")) return Response.json({ public: false });
      return Response.json({ url: "/object/upload/sign/audiobooks/books/Book/track.mp3?token=short-lived" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const signedUrl = await createSignedStorageUploadUrl(config, "Book", "track.mp3");
    expect(signedUrl).toBe("https://project.supabase.co/storage/v1/object/upload/sign/audiobooks/books/Book/track.mp3?token=short-lived");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuses to upload to a public bucket", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ public: true })));
    await expect(createSignedStorageUploadUrl(config, "Book", "track.mp3")).rejects.toThrow("must be private");
  });
});

describe("Supabase library sync", () => {
  it("downloads bucket objects into the cache and scans the registered root", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "audiobook-storage-"));
    const syncConfig = { ...config, cacheDir };
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/bucket/")) return Response.json({ public: false });
      if (url.includes("/object/list/")) {
        const body = JSON.parse(String(init?.body)) as { prefix: string };
        return Response.json(body.prefix === "books"
          ? [{ name: "Book", id: null }]
          : [{ name: "01.mp3", id: "object-id", metadata: { size: 10 } }]);
      }
      return new Response("audio-data");
    });
    vi.stubGlobal("fetch", fetchMock);
    const scanner = { scanRoot: vi.fn(async () => {}), getProgress: vi.fn() } as unknown as ScanManager;
    const prisma = {
      libraryRoot: { upsert: vi.fn(async () => ({ id: 7 })) },
    } as unknown as PrismaClient;
    const sync = createSupabaseLibrarySync({ config: syncConfig, prisma, scanner });

    try {
      expect(sync.start()).toBe(true);
      await vi.waitFor(() => expect(sync.state().status).toBe("complete"));
      expect(await readFile(path.join(cacheDir, "Book", "01.mp3"), "utf8")).toBe("audio-data");
      expect(prisma.libraryRoot.upsert).toHaveBeenCalledWith({
        where: { path: path.resolve(cacheDir) },
        create: { path: path.resolve(cacheDir), label: "Supabase audiobooks" },
        update: { label: "Supabase audiobooks" },
      });
      expect(scanner.scanRoot).toHaveBeenCalledWith(7);
      expect(sync.state().filesDownloaded).toBe(1);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });
});
