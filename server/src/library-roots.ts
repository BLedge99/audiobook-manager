/**
 * The library-root management rule, owned once (spec 37, step 7.8).
 *
 * Both listeners (the family listener and the admin listener) create,
 * update, list and delete library roots, and trigger scans. They share this
 * module so the error vocabulary, the path resolution and the scan trigger
 * exist exactly once. The listeners keep their own auth boundaries; only a
 * different door, never a different implementation (ADR 022).
 */
import { access } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";

export type CreateRootResult =
  | { ok: true; root: { id: number; path: string; label: string | null } }
  | { ok: false; reason: "path-required" | "path-inaccessible" };

/**
 * Create or update (by resolved path) a library root. The caller maps the
 * failure reason onto its own error vocabulary.
 */
export async function upsertLibraryRoot(
  prisma: PrismaClient,
  input: { path?: string; label?: string },
): Promise<CreateRootResult> {
  const rootPath = input.path?.trim();
  if (!rootPath) return { ok: false, reason: "path-required" };
  try {
    await access(rootPath);
  } catch {
    return { ok: false, reason: "path-inaccessible" };
  }
  const resolved = path.resolve(rootPath);
  const root = await prisma.libraryRoot.upsert({
    where: { path: resolved },
    create: { path: resolved, label: input.label?.trim() || path.basename(resolved) },
    update: { label: input.label?.trim() || path.basename(resolved) },
  });
  return { ok: true, root };
}

export type DeleteRootResult =
  | { ok: true }
  | { ok: false; reason: "invalid-id" | "not-found" };

/** Delete a library root by id-like param. Deletes are not cascading. */
export async function deleteLibraryRoot(
  prisma: PrismaClient,
  rawId: string | undefined,
): Promise<DeleteRootResult> {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id < 1) return { ok: false, reason: "invalid-id" };
  const exists = await prisma.libraryRoot.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return { ok: false, reason: "not-found" };
  await prisma.libraryRoot.delete({ where: { id } });
  return { ok: true };
}
