import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import type { ScanManager } from "../scanner";
import { EnrichmentManager } from "../metadata/run";
import { AUDIO_EXTENSIONS } from "../scan-utils";

export const MAX_STORAGE_FILE_BYTES = 50 * 1024 * 1024;
const STORAGE_PREFIX = "books";

export type SupabaseStorageConfig = {
  url: string;
  serviceRoleKey: string;
  bucket: string;
  cacheDir: string;
};

export type StorageSyncState = {
  status: "idle" | "syncing" | "complete" | "error";
  filesDownloaded: number;
  lastSyncAt: string | null;
  message: string | null;
};

type StorageEntry = {
  name: string;
  id: string | null;
  metadata?: { size?: number | string } | null;
};

export type StorageSync = {
  start(): boolean;
  state(): StorageSyncState;
};

function isAudioObject(objectPath: string): boolean {
  return AUDIO_EXTENSIONS.has(path.posix.extname(objectPath).toLowerCase());
}

function cleanPathSegment(value: string): string | null {
  if (!value || value === "." || value === ".." || /[\u0000-\u001f\u007f]/.test(value)) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { return null; }
  if (decoded === "." || decoded === ".." || decoded.includes("/") || decoded.includes("\\")) return null;
  return value;
}

export function storageObjectKey(bookName: string, relativePath: string): string | null {
  const book = bookName.trim();
  if (!book || book.length > 120 || cleanPathSegment(book) === null) return null;
  if (!relativePath || relativePath.length > 900 || relativePath.includes("\\")) return null;
  const parts = relativePath.split("/");
  if (!parts.length || parts.some((part) => cleanPathSegment(part) === null)) return null;
  const objectPath = `${STORAGE_PREFIX}/${book}/${parts.join("/")}`;
  if (!isAudioObject(objectPath) || objectPath.length > 1024) return null;
  return objectPath;
}

export function supabaseStorageConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SupabaseStorageConfig | null {
  const values = [
    env.SUPABASE_URL?.trim(),
    env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
    env.SUPABASE_STORAGE_BUCKET?.trim(),
  ];
  if (values.every((value) => !value)) return null;
  if (values.some((value) => !value)) {
    throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_STORAGE_BUCKET must be configured together");
  }
  const url = new URL(values[0]!);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error("SUPABASE_URL must use HTTPS");
  }
  const bucket = values[2]!;
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(bucket)) throw new Error("SUPABASE_STORAGE_BUCKET is invalid");
  return {
    url: url.toString().replace(/\/+$/, ""),
    serviceRoleKey: values[1]!,
    bucket,
    cacheDir: env.SUPABASE_CACHE_DIR?.trim() || "/data/audiobooks",
  };
}

function storageApiUrl(config: SupabaseStorageConfig, endpoint: string): string {
  return `${config.url}/storage/v1${endpoint}`;
}

async function storageFetch(
  config: SupabaseStorageConfig,
  endpoint: string,
  init: RequestInit = {},
): Promise<Response> {
  const response = await fetch(storageApiUrl(config, endpoint), {
    ...init,
    headers: {
      authorization: `Bearer ${config.serviceRoleKey}`,
      apikey: config.serviceRoleKey,
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error(`Supabase Storage request failed (${response.status})`);
  return response;
}

async function assertPrivateBucket(config: SupabaseStorageConfig): Promise<void> {
  const response = await storageFetch(config, `/bucket/${encodeURIComponent(config.bucket)}`);
  const bucket = await response.json() as { public?: boolean };
  if (bucket.public !== false) throw new Error("Supabase Storage bucket must be private");
}

function encodeObjectPath(objectPath: string): string {
  return objectPath.split("/").map(encodeURIComponent).join("/");
}

export async function createSignedStorageUploadUrl(
  config: SupabaseStorageConfig,
  bookName: string,
  relativePath: string,
): Promise<string> {
  const objectPath = storageObjectKey(bookName, relativePath);
  if (!objectPath) throw new Error("storage_object_path_invalid");
  await assertPrivateBucket(config);
  const endpoint = `/object/upload/sign/${encodeURIComponent(config.bucket)}/${encodeObjectPath(objectPath)}`;
  const response = await storageFetch(config, endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ upsert: true }),
  });
  const result = await response.json() as { url?: string; token?: string };
  if (!result.url && !result.token) throw new Error("Supabase Storage did not return a signed upload URL");
  if (result.url) {
    if (/^https?:\/\//i.test(result.url)) return result.url;
    const urlPath = result.url.startsWith("/storage/v1/")
      ? result.url
      : `/storage/v1${result.url.startsWith("/") ? result.url : `/${result.url}`}`;
    return `${config.url}${urlPath}`;
  }
  return `${storageApiUrl(config, endpoint)}?token=${encodeURIComponent(result.token!)}`;
}

async function listStorageAudio(config: SupabaseStorageConfig): Promise<{ path: string; size?: number }[]> {
  await assertPrivateBucket(config);
  const directories = [STORAGE_PREFIX];
  const objects: { path: string; size?: number }[] = [];
  while (directories.length) {
    const prefix = directories.pop()!;
    let offset = 0;
    while (true) {
      const response = await storageFetch(
        config,
        `/object/list/${encodeURIComponent(config.bucket)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            prefix,
            limit: 1000,
            offset,
            sortBy: { column: "name", order: "asc" },
          }),
        },
      );
      const entries = await response.json() as StorageEntry[];
      for (const entry of entries) {
        const segment = cleanPathSegment(entry.name);
        if (!segment) throw new Error("Supabase Storage returned an invalid object name");
        const objectPath = `${prefix}/${segment}`;
        if (entry.id === null) {
          directories.push(objectPath);
        } else if (isAudioObject(objectPath)) {
          const size = Number(entry.metadata?.size);
          if (Number.isFinite(size) && size > MAX_STORAGE_FILE_BYTES) {
            throw new Error("A stored audio file exceeds the 50 MB upload limit");
          }
          objects.push({ path: objectPath, ...(Number.isFinite(size) && size >= 0 ? { size } : {}) });
        }
      }
      if (entries.length < 1000) break;
      offset += entries.length;
    }
  }
  return objects;
}

function localObjectPath(cacheDir: string, objectPath: string): string {
  const relativeParts = objectPath.split("/");
  if (relativeParts[0] !== STORAGE_PREFIX || relativeParts.length < 3) {
    throw new Error("Supabase Storage returned an object outside the books prefix");
  }
  if (relativeParts.some((part) => cleanPathSegment(part) === null)) {
    throw new Error("Supabase Storage returned an invalid object path");
  }
  const root = path.resolve(cacheDir);
  const destination = path.resolve(root, ...relativeParts.slice(1));
  if (!destination.startsWith(`${root}${path.sep}`)) {
    throw new Error("Supabase Storage object escaped the library cache");
  }
  return destination;
}

async function downloadStorageAudio(config: SupabaseStorageConfig, cacheDir: string): Promise<number> {
  await mkdir(cacheDir, { recursive: true });
  const objects = await listStorageAudio(config);
  let downloaded = 0;
  for (const object of objects) {
    const destination = localObjectPath(cacheDir, object.path);
    const response = await storageFetch(
      config,
      `/object/${encodeURIComponent(config.bucket)}/${encodeObjectPath(object.path)}`,
    );
    const data = Buffer.from(await response.arrayBuffer());
    if (data.byteLength > MAX_STORAGE_FILE_BYTES) {
      throw new Error("A stored audio file exceeds the 50 MB upload limit");
    }
    if (object.size !== undefined && data.byteLength !== object.size) {
      throw new Error("Downloaded audio size did not match Supabase Storage metadata");
    }
    await mkdir(path.dirname(destination), { recursive: true });
    const temporaryPath = `${destination}.${randomUUID()}.partial`;
    try {
      await writeFile(temporaryPath, data, { flag: "wx" });
      await rename(temporaryPath, destination);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
    downloaded++;
  }
  return downloaded;
}

export function createSupabaseLibrarySync(options: {
  config: SupabaseStorageConfig;
  prisma: PrismaClient;
  scanner: ScanManager;
  onError?: (error: unknown) => void;
}): StorageSync {
  let state: StorageSyncState = {
    status: "idle", filesDownloaded: 0, lastSyncAt: null, message: null,
  };
  let running = false;
  return {
    state: () => ({ ...state }),
    start() {
      if (running) return false;
      running = true;
      state = { ...state, status: "syncing", message: null };
      void (async () => {
        const filesDownloaded = await downloadStorageAudio(options.config, options.config.cacheDir);
        const resolvedCacheDir = path.resolve(options.config.cacheDir);
        const root = await options.prisma.libraryRoot.upsert({
          where: { path: resolvedCacheDir },
          create: { path: resolvedCacheDir, label: "Supabase audiobooks" },
          update: { label: "Supabase audiobooks" },
        });
        await options.scanner.scanRoot(root.id);
        await new EnrichmentManager(options.prisma).enqueue();
        state = {
          status: "complete",
          filesDownloaded,
          lastSyncAt: new Date().toISOString(),
          message: null,
        };
      })().catch((error: unknown) => {
        options.onError?.(error);
        state = {
          ...state,
          status: "error",
          lastSyncAt: new Date().toISOString(),
          message: "storage_sync_failed",
        };
      }).finally(() => { running = false; });
      return true;
    },
  };
}
