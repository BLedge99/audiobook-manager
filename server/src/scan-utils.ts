import path from "node:path";

export const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".m4b", ".flac", ".ogg", ".wav", ".aac"]);

export function isAudioFile(filePath: string): boolean {
  return AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/** Group files by their containing directory (one group = one logical audiobook). */
export function groupFiles<T extends { filePath: string }>(files: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const file of files) {
    const directory = path.dirname(file.filePath);
    const group = groups.get(directory) || [];
    group.push(file);
    groups.set(directory, group);
  }
  return [...groups.values()];
}

/**
 * Strip a trailing author credit from an album tag.
 *
 * LibriVox writes the book title and author together:
 *   album "Creepy Tales by Edgar Allen Poe" + artist "Edgar Allen Poe"
 * Keeping "by Edgar Allen Poe" in the title would render the grid as
 * "Creepy Tales by Edgar Allen Poe / Edgar Allen Poe".
 *
 * Only strips when the author part is short enough to plausibly be a credit
 * rather than part of the title itself.
 */
export function stripAuthorCredit(album: string, knownAuthor?: string | null): string {
  const match = album.match(/^(.*?)\s+by\s+(.+)$/i);
  if (!match) return album;
  const title = match[1].trim();
  const credit = match[2].trim();
  if (!title || !credit) return album;
  // "The Story of My Life by Someone" is a title, not a credit.
  if (credit.split(/\s+/).length > 6) return album;
  // Only strip a credit we can corroborate against the known artist, or a
  // single-word credit, to avoid mangling titles like "Sailing By".
  if (knownAuthor && !credit.toLowerCase().startsWith(knownAuthor.toLowerCase().slice(0, 8))) {
    return album;
  }
  return title;
}

/**
 * The single most common non-empty album tag in a group.
 *
 * A book's tracks nearly always agree; when they disagree, majority wins so
 * one malformed file cannot rename the whole book. Ties break on first
 * appearance for determinism.
 */
export function mostCommonAlbum(albums: (string | null | undefined)[]): string | null {
  interface Tally {
    name: string;
    count: number;
    firstIndex: number;
  }
  const counts = new Map<string, Tally>();
  let best: Tally | null = null;

  // A plain loop, not forEach: assigning `best` inside a closure defeats
  // TypeScript's control-flow narrowing and it ends up typed `never`.
  for (let index = 0; index < albums.length; index += 1) {
    const trimmed = albums[index]?.trim();
    if (!trimmed) continue;
    const entry = counts.get(trimmed) ?? { name: trimmed, count: 0, firstIndex: index };
    entry.count += 1;
    counts.set(trimmed, entry);
    if (!best || entry.count > best.count || (entry.count === best.count && entry.firstIndex < best.firstIndex)) {
      best = { ...entry };
    }
  }

  return best ? best.name : null;
}

/**
 * Derive a book's display title for a group of audio files.
 *
 * A single-file group uses the file's own title. A multi-file group prefers
 * the album tag, because that is where LibriVox and most audiobook rippers
 * put the *book* title -- the per-track title is a section name
 * ("01 - THE TELL-TALE HEART") and the folder is often an archive.org
 * identifier ("ghohor034_1907_librivox"). Neither is usable as a title.
 */
export function audiobookTitle(
  group: { filePath: string; title: string; album?: string | null; author?: string | null }[],
): string {
  if (group.length === 0) return "Unknown title";
  if (group.length === 1) return group[0].title;

  const album = mostCommonAlbum(group.map((file) => file.album));
  if (album) {
    const author = mostCommonAlbum(group.map((file) => file.author));
    return stripAuthorCredit(album, author);
  }
  return path.basename(path.dirname(group[0].filePath));
}

/** Fallback title from a filename: strip extension and leading track numbers. */
export function titleFromFilename(filePath: string): string {
  const base = path.basename(filePath, path.extname(filePath));
  const cleaned = base.replace(/^\d+[\s_.-]*/, "").trim();
  return cleaned || base;
}
