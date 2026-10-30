import type { PrismaClient } from "@prisma/client";
import { normalizeText, type ProviderChapter } from "./types";

/**
 * Spec 21 — official chapter titles.
 *
 * A multi-file book renders one segment per file, and the client shows
 * `track.title` verbatim. Embedded tags give section names that are often
 * either useless ("Section 01") or redundant with the track number
 * ("01 - THE TELL-TALE HEART"). Providers know the real chapter names, so this
 * module matches provider chapters onto tracks.
 *
 * Matching is by *identity* (the audio filename the provider names) wherever
 * possible, and only falls back to position when the counts agree exactly.
 * Positional matching is what silently mislabels chapters the moment a book is
 * re-encoded, reordered, or has a file added.
 */

/**
 * Strip a leading track number: "01 - Title", "12. Title", "03_Title", "(4) Title".
 *
 * Two separate patterns because one combined pattern is either too greedy
 * (it eats the "2001" in "2001 A Space Odyssey") or too weak (it misses
 * "(4) Title"). Each requires its own evidence of a track number: either a
 * bracket pair, or an explicit separator.
 */
export function stripTrackNumberPrefix(title: string): string {
  const patterns = [
    // Bracketed: "(4) Title", "[04] Title"
    /^[\[(]\s*\d+\s*[\])]\s*/,
    // Separated: "01 - Title", "12. Title", "03_Title"
    /^\s*\d+\s*[-–—._:]\s*/,
  ];
  for (const pattern of patterns) {
    const stripped = title.replace(pattern, "").trim();
    // Reject a pattern that consumed the whole title: a bare "42" is a
    // legitimate title, not a track number.
    if (stripped.length > 0 && stripped !== title) return stripped;
  }
  return title.trim();
}

/** True when a title carries no information beyond its position. */
export function isPlaceholderTitle(title: string | null | undefined): boolean {
  const trimmed = (title ?? "").trim();
  if (!trimmed) return true;
  return /^(section|chapter|part|track|track \d+|cd)[\s._-]*\d*$/i.test(trimmed);
}

function basenameOf(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

/* ------------------------------------------------------------------ *
 * User-set track titles (ADR 009 precedence, extended to tracks)
 * ------------------------------------------------------------------ */

/**
 * A hand-set track title lives in `FieldOverride` under `trackTitle:<n>`.
 *
 * Deliberately *not* a column on `Track`: the scanner deletes and recreates
 * every track on each rescan, so a flag or value stored there would be wiped
 * before the next scan. `FieldOverride` hangs off `MediaItem`, survives the
 * rescan, and is already covered by the spec 17 reset endpoints -- so clearing
 * overrides releases track titles too, with no new machinery.
 *
 * Keyed by track *number* rather than track id for the same reason: track ids
 * are reassigned on every rescan.
 */
export function trackTitleOverrideField(trackNumber: number): string {
  return `trackTitle:${trackNumber}`;
}

/** Pull the `trackTitle:<n>` entries out of a book's override rows. */
export function parseTrackTitleOverrides(rows: { field: string; value: string }[]): Map<number, string> {
  const overrides = new Map<number, string>();
  for (const row of rows) {
    const match = row.field.match(/^trackTitle:(\d+)$/);
    if (!match) continue;
    const value = row.value.trim();
    // An empty override would blank the chapter and block the provider from
    // ever filling it in, which is the opposite of what clearing means. The
    // write path deletes such rows; refuse them on read as well.
    if (value.length === 0) continue;
    overrides.set(Number.parseInt(match[1], 10), value);
  }
  return overrides;
}

/**
 * The title a track should carry, given the embedded tag and any user overrides.
 *
 * `user override > provider/embedded`, per ADR 009. Used by the scanner when it
 * recreates tracks, so a hand-set name survives every subsequent rescan.
 */
export function resolveTrackTitle(
  trackNumber: number,
  embeddedTitle: string,
  overrides: Map<number, string>,
): string {
  return overrides.get(trackNumber) ?? embeddedTitle;
}

/**
 * Match provider chapters to tracks.
 *
 * Returns one entry per matched track, in track order. Tracks with no
 * confident match are simply absent, so a partial result improves the book
 * rather than corrupting it.
 */
export function matchChaptersToTracks(
  tracks: { id: number; filePath: string; title?: string | null }[],
  chapters: ProviderChapter[],
): Map<number, string> {
  const matched = new Map<number, string>();
  if (tracks.length === 0 || chapters.length === 0) return matched;

  const ordered = [...tracks].sort((a, b) => a.id - b.id);
  const byId = new Map(ordered.map((track) => [track.id, track]));

  // Pass 1: identity match on the audio filename the provider names.
  const remaining = new Set<ProviderChapter>();
  const byFileName = new Map<string, ProviderChapter[]>();
  for (const chapter of chapters) {
    if (!chapter.fileName) {
      remaining.add(chapter);
      continue;
    }
    const key = normalizeText(basenameOf(chapter.fileName));
    const list = byFileName.get(key) ?? [];
    list.push(chapter);
    byFileName.set(key, list);
  }

  for (const track of ordered) {
    const key = normalizeText(basenameOf(track.filePath));
    const candidates = byFileName.get(key);
    const chapter = candidates?.find((entry) => !remaining.has(entry));
    if (!chapter) continue;
    remaining.delete(chapter);
    matched.set(track.id, chapter.title);
  }

  // Pass 2: positional, only when what is left lines up exactly one-to-one.
  // A mismatch means the provider's file list and ours disagree, and guessing
  // would mislabel every chapter from the first divergence onward.
  if (remaining.size === 0) return matched;

  const unmatchedTracks = ordered.filter((track) => !matched.has(track.id));
  const leftovers = chapters.filter((chapter) => remaining.has(chapter));

  // Only spend the weak positional signal on a track whose title carries no
  // information ("Section 01"). A track with a real embedded title keeps it.
  if (leftovers.length === unmatchedTracks.length) {
    // A plain loop, not forEach: `continue` inside a callback is a syntax
    // error ("jump target cannot cross function boundary").
    for (let index = 0; index < leftovers.length; index += 1) {
      if (!isPlaceholderTitle(unmatchedTracks[index].title)) continue;
      matched.set(unmatchedTracks[index].id, leftovers[index].title);
    }
  }

  return matched;
}

/**
 * Decide whether a provider chapter title is an improvement.
 *
 * "Section 01" -> "Chapters I-V" is an improvement. "01 - At the Gate" ->
 * "At the Gate" is an improvement. But replacing a descriptive embedded title
 * with a generic "Chapter 3" is not, so we never take a step backwards.
 */
export function isBetterChapterTitle(current: string | null | undefined, incoming: string): boolean {
  const next = incoming.trim();
  if (!next) return false;
  if (isPlaceholderTitle(next)) return false;
  const existing = (current ?? "").trim();
  if (!existing) return true;
  if (isPlaceholderTitle(existing)) return true;

  // Already exactly right. Returning false makes a repeated enrichment pass a
  // genuine no-op; without this every run rewrote every correct track title,
  // bumping `updatedAt` on rows that had not actually changed.
  if (normalizeText(existing) === normalizeText(next)) return false;

  // Strip the number prefix from the existing value before judging: the
  // provider version is usually identical once the prefix is removed, and in
  // that case the write *is* worthwhile -- it removes the redundant prefix.
  const existingBare = stripTrackNumberPrefix(existing);
  if (normalizeText(existingBare) === normalizeText(next)) return true;

  // Prefer whichever is more descriptive; a longer title with real words wins.
  return existingBare.length === 0 || next.length > existingBare.length;
}

/**
 * Apply provider chapter titles to a multi-file book's tracks.
 *
 * Only improves titles: an existing descriptive embedded title is never
 * replaced by a generic one, and a title the user has set by hand is left alone.
 * Returns the number of tracks actually changed.
 *
 * The override check lives here rather than being handed in, because every
 * caller would otherwise have to remember to pass it -- and the two existing
 * call sites did not, which is how a checked-off acceptance criterion ended up
 * being enforced by nothing at all.
 */
export async function applyChapterTitles(
  prisma: PrismaClient,
  mediaItemId: number,
  chapters: ProviderChapter[],
): Promise<number> {
  if (chapters.length === 0) return 0;

  const [tracks, overrideRows] = await Promise.all([
    prisma.track.findMany({
      where: { mediaItemId },
      orderBy: { trackNumber: "asc" },
      select: { id: true, filePath: true, trackNumber: true, title: true },
    }),
    prisma.fieldOverride.findMany({
      where: { mediaItemId, field: { startsWith: "trackTitle:" } },
      select: { field: true, value: true },
    }),
  ]);
  if (tracks.length === 0) return 0;

  const lockedTrackNumbers = new Set(parseTrackTitleOverrides(overrideRows).keys());
  const eligible = lockedTrackNumbers.size > 0 ? tracks.filter((track) => !lockedTrackNumbers.has(track.trackNumber)) : tracks;

  const matches = matchChaptersToTracks(eligible, chapters);
  if (matches.size === 0) return 0;

  let changed = 0;
  for (const [trackId, incoming] of matches) {
    const track = tracks.find((entry) => entry.id === trackId);
    if (!track || !isBetterChapterTitle(track.title, incoming)) continue;
    await prisma.track.update({ where: { id: trackId }, data: { title: incoming } });
    changed += 1;
  }
  return changed;
}