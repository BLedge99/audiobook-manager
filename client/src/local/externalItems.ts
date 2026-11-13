/**
 * External library items (spec 39 — Feature A).
 *
 * A book the listener owns in Audible / Google Play Books / Kobo / Libro.fm.
 * Device-local only, by construction:
 *
 * - The row never leaves this store (no API call, no sync, no export).
 * - It carries no file path, no progress, no relation to the replica; the
 *   app opens it in the store's own app/site via `externalIntent.ts`.
 * - Dedupe identity is `store + externalId`: the same URL added twice is
 *   the same item, not a new row.
 *
 * All parsing goes through `lib/externalStores.ts`; nothing here decides
 * whether a URL belongs to a store — that is the registry's job.
 */

import type { ExternalItem, LocalLibraryDatabase } from "./db";
import { parseStoreUrl } from "../lib/externalStores";

export type AddExternalResult =
  | { ok: true; item: ExternalItem; created: boolean }
  | { ok: false; code: "unsupported-host" | "invalid-url" | "unrecognised-shape" };

function now(): string {
  return new Date().toISOString();
}

/**
 * Add a pasted store URL to the device's external shelf.
 *
 * `overrides.title` / `overrides.author` win over the registry's slug hint —
 * the add dialog passes the user-corrected values so a corrected title never
 * round-trips through a lossy deslug.
 */
export async function addExternalItem(
  db: LocalLibraryDatabase,
  rawUrl: string,
  overrides?: { title?: string; author?: string | null },
): Promise<AddExternalResult> {
  const parsed = parseStoreUrl(rawUrl);
  if (!parsed.ok) return { ok: false, code: parsed.code };

  const existing = await db.externalItems
    .where("[store+externalId]")
    .equals([parsed.store, parsed.externalId])
    .first();
  if (existing) return { ok: true, item: existing, created: false };

  const title = overrides?.title?.trim() || parsed.titleHint || "A book from a store";
  const item: ExternalItem = {
    id: crypto.randomUUID(),
    store: parsed.store,
    externalId: parsed.externalId,
    httpsUrl: parsed.httpsUrl,
    title,
    author: overrides?.author?.trim() ? overrides.author.trim() : null,
    narrator: null,
    coverUrl: null,
    createdAt: now(),
  };
  await db.externalItems.put(item);
  return { ok: true, item, created: true };
}

/** Newest first. */
export async function listExternalItems(db: LocalLibraryDatabase): Promise<ExternalItem[]> {
  const items = await db.externalItems.toArray();
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function removeExternalItem(db: LocalLibraryDatabase, id: string): Promise<void> {
  await db.externalItems.delete(id);
}
