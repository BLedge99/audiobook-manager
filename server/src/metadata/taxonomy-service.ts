import type { PrismaClient } from "@prisma/client";
import { GENRE_TAXONOMY, PROVIDER_GENRE_MAPPING, type GenreSeed } from "./taxonomy";
import { normalizeText } from "./types";

/**
 * Supavisor (the Supabase connection pooler) in transaction mode cannot hold
 * an interactive `$transaction` across queries — every boot on the hosted demo
 * failed the taxonomy seed with P2028. SQLite integration tests, on the other
 * hand, cannot afford the per-row upserts' fsyncs without a transaction. Both
 * paths are legitimate; pick per provider.
 */
function isPostgres(): boolean {
  return (process.env.DATABASE_URL ?? "").startsWith("postgres");
}

/**
 * Spec 17 — taxonomy seeding, provider-string mapping, and contributor
 * reconciliation.
 */

/**
 * Idempotent seed. Safe to run on every boot: slugs are unique, so a repeat
 * run updates names/sort order rather than duplicating. Operator edits to
 * `name` are preserved, because a re-seed only fills a name when the row has
 * none -- the slug is the stable identity.
 *
 * SQLite: one transaction — the per-row upserts each used to be their own
 * commit (~150 fsyncs on every boot), which blew the 10s integration-test
 * timeout on a loaded machine (spec 43).
 *
 * Postgres (the hosted demo, Supavisor transaction mode): one transaction
 * fails outright with P2028 — the pooler cannot hold an interactive
 * transaction across pooled connections. Per-row upserts are the same shape,
 * just outside a transaction.
 */
export async function seedGenres(prisma: PrismaClient): Promise<number> {
  let created = 0;

  const upsert = async (
    client: Pick<PrismaClient, "genre">,
    seed: GenreSeed,
    parentId: number | null,
    sortOrder: number,
  ): Promise<number> => {
    const existing = await client.genre.findUnique({ where: { slug: seed.slug } });
    const row = await client.genre.upsert({
      where: { slug: seed.slug },
      create: {
        slug: seed.slug,
        name: seed.name,
        parentId,
        sortOrder,
        isCatchAll: seed.isCatchAll ?? false,
      },
      update: { parentId, sortOrder, isCatchAll: seed.isCatchAll ?? false },
    });
    if (!existing) created += 1;
    return row.id;
  };

  if (isPostgres()) {
    for (const [index, top] of GENRE_TAXONOMY.entries()) {
      const parentId = await upsert(prisma, top, null, index);
      for (const [childIndex, child] of (top.children ?? []).entries()) {
        await upsert(prisma, child, parentId, childIndex);
      }
    }
    return created;
  }

  await prisma.$transaction(async (tx) => {
    const upsertTx = (txClient: typeof tx) => (seed: GenreSeed, parentId: number | null, sortOrder: number) =>
      upsert(txClient, seed, parentId, sortOrder);
    const inner = upsertTx(tx);
    for (const [index, top] of GENRE_TAXONOMY.entries()) {
      const parentId = await inner(top, null, index);
      for (const [childIndex, child] of (top.children ?? []).entries()) {
        await inner(child, parentId, childIndex);
      }
    }
  });
  return created;
}

/** Idempotent seed of the provider-string mappings. Shape matches seedGenres. */
export async function seedGenreMappings(prisma: PrismaClient): Promise<number> {
  let created = 0;
  const inner = async (client: Pick<PrismaClient, "genre" | "genreMapping">) => {
    for (const [provider, mapping] of Object.entries(PROVIDER_GENRE_MAPPING)) {
      for (const [rawValue, slug] of Object.entries(mapping)) {
        const genre = await client.genre.findUnique({ where: { slug } });
        if (!genre) continue; // mapping points at a genre the seed did not create
        const existing = await client.genreMapping.findUnique({
          where: { provider_rawValue: { provider, rawValue } },
        });
        if (!existing) created += 1;
        await client.genreMapping.upsert({
          where: { provider_rawValue: { provider, rawValue } },
          create: { provider, rawValue, genreId: genre.id },
          update: { genreId: genre.id },
        });
      }
    }
  };
  if (isPostgres()) {
    await inner(prisma);
    return created;
  }
  await prisma.$transaction((tx) => inner(tx));
  return created;
}

/**
 * Resolve one provider genre string to a genre id.
 *
 * Matching is case-insensitive and punctuation-tolerant, done in application
 * code against the provider's (small, ~50 row) mapping set rather than with
 * `mode: "insensitive"`, which Prisma only supports on PostgreSQL.
 *
 * An unmapped string falls back to the catch-all bucket rather than being
 * dropped, so a book always appears under something (spec 17 acceptance
 * criteria).
 */
export async function mapGenreString(
  prisma: PrismaClient,
  provider: string,
  rawValue: string,
): Promise<number | null> {
  const mappings = await prisma.genreMapping.findMany({ where: { provider } });
  const target = normalizeText(rawValue);

  // Exact normalized match.
  const exact = mappings.find((entry) => normalizeText(entry.rawValue) === target);
  if (exact) return exact.genreId;

  // Providers sometimes wrap the name in a longer string, e.g.
  // "Mystery, Thriller & Suspense (see also Crime)". Longest contained match
  // wins so a specific sub-genre beats a generic parent.
  const contained = mappings
    .filter((entry) => {
      const key = normalizeText(entry.rawValue);
      return key.length > 3 && target.includes(key);
    })
    .sort((a, b) => normalizeText(b.rawValue).length - normalizeText(a.rawValue).length);
  if (contained.length > 0) return contained[0].genreId;

  // The server begins listening before its potentially slow, per-row mapping
  // seed completes. Use the checked-in defaults when the matching DB row is
  // not there yet, while still letting an explicit DB mapping take precedence.
  const builtIn = Object.entries(PROVIDER_GENRE_MAPPING[provider] ?? {}).find(
    ([raw]) => normalizeText(raw) === target,
  );
  if (builtIn) {
    const genre = await prisma.genre.findUnique({ where: { slug: builtIn[1] } });
    if (genre) return genre.id;
  }

  const catchAll = await prisma.genre.findFirst({ where: { isCatchAll: true } });
  return catchAll?.id ?? null;
}

/**
 * Replace a book's genres with those resolved from a provider payload.
 *
 * `source: "user"` assignments are left alone: a genre the human chose is not
 * something enrichment may revoke.
 */
export async function applyGenres(
  prisma: PrismaClient,
  mediaItemId: number,
  provider: string,
  rawGenres: string[],
): Promise<number> {
  if (rawGenres.length === 0) return 0;

  const genreIds: number[] = [];
  for (const raw of rawGenres) {
    if (!raw?.trim()) continue;
    const genreId = await mapGenreString(prisma, provider, raw.trim());
    if (genreId !== null && !genreIds.includes(genreId)) genreIds.push(genreId);
  }
  if (genreIds.length === 0) return 0;

  const existing = await prisma.mediaItemGenre.findMany({ where: { mediaItemId } });
  const userAssigned = new Set(existing.filter((row) => row.source === "user").map((row) => row.genreId));

  // Drop provider-assigned genres the new payload does not include, but never
  // touch a user assignment.
  const stale = existing
    .filter((row) => row.source !== "user" && !genreIds.includes(row.genreId))
    .map((row) => row.genreId);
  if (stale.length > 0) {
    await prisma.mediaItemGenre.deleteMany({ where: { mediaItemId, genreId: { in: stale } } });
  }

  const toCreate = genreIds.filter((id) => !userAssigned.has(id) && !existing.some((row) => row.genreId === id));
  if (toCreate.length > 0) {
    await prisma.mediaItemGenre.createMany({
      data: toCreate.map((genreId) => ({ mediaItemId, genreId, source: "provider" })),
    });
  }
  return genreIds.length;
}

// ---------------------------------------------------------------------
// Contributor reconciliation
// ---------------------------------------------------------------------

export type ContributorRole = "author" | "narrator" | "translator" | "editor" | "illustrator";

export interface ContributorSpec {
  name: string;
  role: ContributorRole;
}

/**
 * Replace a book's contributor set.
 *
 * Spec 01 added contributors but never removed them, so re-enriching a book
 * with a different match left the previous match's narrators attached forever.
 * Reconciliation deletes links that the new set does not include. Contributor
 * rows themselves are left alone when orphaned: they are cheap, shared across
 * books, and deleting them would churn a shared table.
 */
export async function reconcileContributors(
  prisma: PrismaClient,
  mediaItemId: number,
  contributors: ContributorSpec[],
): Promise<number> {
  const cleaned = contributors
    .map((entry) => ({ name: entry.name.trim(), role: entry.role }))
    .filter((entry) => entry.name.length > 0);

  // De-duplicate on the (name, role) unique key.
  const seen = new Set<string>();
  const unique = cleaned.filter((entry) => {
    const key = `${entry.name.toLowerCase()}::${entry.role}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const rows: { contributorId: number; mediaItemId: number }[] = [];
  for (const entry of unique) {
    const contributor = await prisma.contributor.upsert({
      where: { name_role: { name: entry.name, role: entry.role } },
      create: { name: entry.name, role: entry.role },
      update: {},
    });
    rows.push({ contributorId: contributor.id, mediaItemId });
  }

  const existing = await prisma.contributorMediaItem.findMany({ where: { mediaItemId } });
  const keep = new Set(rows.map((row) => row.contributorId));
  const stale = existing.filter((row) => !keep.has(row.contributorId)).map((row) => row.contributorId);

  if (stale.length > 0) {
    await prisma.contributorMediaItem.deleteMany({
      where: { mediaItemId, contributorId: { in: stale } },
    });
  }
  // Note the distinct parameter name: an inner `row` would shadow the outer
  // one and compare a field with itself, making this always false.
  const missing = rows.filter(
    (candidate) => !existing.some((linked) => linked.contributorId === candidate.contributorId),
  );
  if (missing.length > 0) {
    await prisma.contributorMediaItem.createMany({ data: missing });
  }

  return unique.length;
}

/**
 * Upsert a normalised Series row and return its id.
 *
 * Matching is on `key` (a lowercased, punctuation-stripped form of the name),
 * so "The Expanse", "the expanse" and "The Expanse!" are one series. Prisma's
 * case-insensitive filter is PostgreSQL-only and these migrations must stay
 * portable, hence a stored column rather than `mode: "insensitive"`.
 */
export async function upsertSeries(prisma: PrismaClient, name: string): Promise<number | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const key = normalizeText(trimmed);
  if (!key) return null;

  const existing = await prisma.series.findUnique({ where: { key } });
  if (existing) return existing.id;
  return (await prisma.series.create({ data: { name: trimmed, key } })).id;
}