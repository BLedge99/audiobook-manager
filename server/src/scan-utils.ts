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

/** Single-file groups use the file's own title; multi-file groups use the folder name. */
export function audiobookTitle(group: { filePath: string; title: string }[]): string {
  if (group.length === 0) return "Unknown title";
  if (group.length === 1) return group[0].title;
  return path.basename(path.dirname(group[0].filePath));
}

/** Fallback title from a filename: strip extension and leading track numbers. */
export function titleFromFilename(filePath: string): string {
  const base = path.basename(filePath, path.extname(filePath));
  const cleaned = base.replace(/^\d+[\s_.-]*/, "").trim();
  return cleaned || base;
}
