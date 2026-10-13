import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import ffmpeg from "fluent-ffmpeg";
import { execFile } from "node:child_process";
import * as musicMetadata from "music-metadata";
import { PrismaClient } from "@prisma/client";
import { groupFiles, audiobookTitle, titleFromFilename, isAudioFile } from "./scan-utils";
import { stripTrackNumberPrefix, parseTrackTitleOverrides, resolveTrackTitle } from "./metadata/chapters";

export const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".m4b", ".flac", ".ogg", ".wav", ".aac"]);

type AudioFile = {
  filePath: string;
  format: string;
  title: string;
  /** Album tag: for multi-file books this is the book title, not the section. */
  album?: string;
  author: string;
  narrator?: string;
  duration: number;
  sizeBytes: number;
  releaseDate?: Date;
  genre?: string;
  chapters?: ChapterInfo[];
  cover?: { data: Uint8Array; format: string };
};

type ScanProgress = {
  status: "idle" | "scanning" | "complete" | "error";
  filesFound: number;
  message?: string;
  lastScanAt?: Date;
};

type MetadataParser = typeof import("music-metadata");

async function parseAudioFile(filePath: string) {
  const parser = musicMetadata as MetadataParser & { default?: MetadataParser };
  const parseFile = parser.parseFile || parser.default?.parseFile;
  if (!parseFile) throw new Error("music-metadata parseFile export is unavailable");
  return parseFile(filePath, { skipCovers: false });
}

export type ScanManager = ReturnType<typeof createScanManager>;

async function walkAudioFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkAudioFiles(entryPath));
    } else if (entry.isFile() && isAudioFile(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
}

function firstTagValue(value: unknown): string | undefined {
  if (Array.isArray(value)) return value[0] ? String(value[0]) : undefined;
  return value ? String(value) : undefined;
}

function probeDuration(filePath: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (error, metadata) => {
      if (error) return resolve(undefined);
      resolve(metadata.format.duration);
    });
  });
}

type ChapterInfo = { start: number; end: number; title: string };

function probeChapters(filePath: string): Promise<ChapterInfo[] | undefined> {
  return new Promise((resolve) => {
    execFile("ffprobe", ["-v", "quiet", "-print_format", "json", "-show_chapters", filePath], (error, stdout) => {
      if (error) return resolve(undefined);
      try {
        const data = JSON.parse(stdout) as { chapters?: { start_time?: string; end_time?: string; tags?: { title?: string } }[] };
        const chapters = (data.chapters ?? []).map((chapter, index) => ({
          start: Number(chapter.start_time) || 0,
          end: Number(chapter.end_time) || 0,
          title: chapter.tags?.title?.trim() || `Chapter ${index + 1}`,
        })).filter((chapter) => chapter.end > chapter.start);
        resolve(chapters.length ? chapters : undefined);
      } catch {
        resolve(undefined);
      }
    });
  });
}

/**
 * Normalise a per-file title for display as a chapter.
 *
 * Embedded tags routinely carry the track number as a prefix -- "01 - THE
 * TELL-TALE HEART" -- but the player already renders "Track 7" beside it, so
 * the chapter name reads "Track 7 - 07 - THE TELL-TALE HEART". Stripping it is
 * independent of any provider, so books with no provider match still improve.
 */
function cleanTrackTitle(title: string): string {
  const stripped = stripTrackNumberPrefix(title);
  return stripped.length > 0 ? stripped : title;
}

async function readAudioFile(filePath: string): Promise<AudioFile> {
  const metadata = await parseAudioFile(filePath);
  const fileStats = await stat(filePath);
  const common = metadata.common;
  const picture = common.picture?.[0];
  const date = common.date?.trim();
  const parsedDate = date ? new Date(date) : undefined;

  return {
    filePath,
    format: path.extname(filePath).slice(1).toLowerCase(),
    title: common.title?.trim() || titleFromFilename(filePath),
    // The album tag carries the *book* title for multi-file books. LibriVox
    // and most audiobook rippers put the section name in `title` and the book
    // title in `album`; without this the grid shows folder names.
    album: firstTagValue(common.album),
    author: firstTagValue(common.artist) || firstTagValue(common.albumartist) || "Unknown author",
    narrator: firstTagValue(common.composer),
    duration: (await probeDuration(filePath)) || metadata.format.duration || 0,
    sizeBytes: fileStats.size,
    releaseDate: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : undefined,
    genre: common.genre?.filter(Boolean).join(", ") || undefined,
    cover: picture ? { data: picture.data, format: picture.format } : undefined,
    chapters: ["m4b", "m4a", "mp4"].includes(path.extname(filePath).slice(1).toLowerCase()) ? await probeChapters(filePath) : undefined,
  };
}

async function saveCover(file: AudioFile, coverDirectory: string): Promise<string | undefined> {
  if (!file.cover) return undefined;
  await mkdir(coverDirectory, { recursive: true });
  const filename = `${createHash("sha1").update(file.filePath).digest("hex")}.${file.cover.format.split("/").pop() || "jpg"}`;
  const coverPath = path.join(coverDirectory, filename);
  await new Promise<void>((resolve, reject) => {
    const stream = createWriteStream(coverPath);
    stream.on("finish", resolve);
    stream.on("error", reject);
    stream.end(file.cover?.data);
  });
  return coverPath;
}

async function syncContributors(
  prisma: PrismaClient,
  mediaItemId: number,
  author: string | undefined,
  narrator: string | undefined,
): Promise<void> {
  const entries: { name: string; role: string }[] = [];
  if (author && author !== "Unknown author") entries.push({ name: author, role: "author" });
  if (narrator) entries.push({ name: narrator, role: "narrator" });

  for (const entry of entries) {
    const contributor = await prisma.contributor.upsert({
      where: { name_role: { name: entry.name, role: entry.role } },
      create: { name: entry.name, role: entry.role },
      update: {},
    });
    const existing = await prisma.contributorMediaItem.findUnique({
      where: { contributorId_mediaItemId: { contributorId: contributor.id, mediaItemId } },
    });
    if (!existing) {
      await prisma.contributorMediaItem.create({ data: { contributorId: contributor.id, mediaItemId } });
    }
  }
}

export function createScanManager(prisma: PrismaClient) {
  const progress = new Map<number, ScanProgress>();
  const activeScans = new Map<number, Promise<void>>();

  async function scanRoot(rootId: number): Promise<void> {
    if (activeScans.has(rootId)) return activeScans.get(rootId);
    const task = runScan(rootId).finally(() => activeScans.delete(rootId));
    activeScans.set(rootId, task);
    return task;
  }

  async function runScan(rootId: number): Promise<void> {
    const root = await prisma.libraryRoot.findUnique({ where: { id: rootId } });
    if (!root) throw new Error("Library root not found");
    progress.set(rootId, { status: "scanning", filesFound: 0 });
    await prisma.scanState.upsert({
      where: { libraryRootId: rootId },
      create: { libraryRootId: rootId, status: "scanning" },
      update: { status: "scanning", message: null },
    });

    try {
      const files = await walkAudioFiles(root.path);
      const audioFiles: AudioFile[] = [];
      for (const filePath of files) {
        audioFiles.push(await readAudioFile(filePath));
        progress.set(rootId, { status: "scanning", filesFound: audioFiles.length });
        await prisma.scanState.update({ where: { libraryRootId: rootId }, data: { filesFound: audioFiles.length } });
      }

      for (const group of groupFiles(audioFiles)) {
        const primary = group[0];
        const coverDir = process.env.COVER_DIR || "/app/data/covers";
        const coverImagePath = await saveCover(primary, coverDir);
        const existingRow = await prisma.mediaItem.findUnique({
          where: { libraryRootId_filePath: { libraryRootId: rootId, filePath: primary.filePath } },
          select: { id: true, metadataSource: true },
        });
        // Spec 17 / ADR 009: per-field overrides replace the spec 07 all-or-nothing
        // `metadataSource === "user"` sentinel. Fixing only a narrator must no
        // longer freeze the title against rescans.
        //
        // Only the spec 07 `user` sentinel gets the blanket legacy lock, and
        // only when no per-field overrides exist (those rows predate spec 17).
        // `manual` is deliberately NOT locked wholesale: it is written by the
        // spec 16/17 routes, which record real per-field overrides for what
        // the user actually set. Blanket-freezing on `manual` silently and
        // permanently blocked the scanner from ever correcting a title.
        const overrideRows = existingRow
          ? await prisma.fieldOverride.findMany({ where: { mediaItemId: existingRow.id }, select: { field: true } })
          : [];
        const legacyLock = existingRow?.metadataSource === "user" && overrideRows.length === 0;
        const locked = new Set<string>(overrideRows.map((row) => row.field));
        if (legacyLock) {
          locked.add("title").add("author").add("narrator").add("releaseDate").add("genre").add("coverImagePath");
        }
        const writable = (field: string) => !locked.has(field);

        // Provenance is bookkeeping, not content, so it is always refreshed.
        const embedded: Record<string, unknown> = { metadataSource: "embedded" };
        if (writable("title")) embedded.title = audiobookTitle(group);
        if (writable("author")) embedded.author = primary.author;
        if (writable("narrator")) embedded.narrator = primary.narrator;
        if (writable("releaseDate")) embedded.releaseDate = primary.releaseDate;
        if (writable("genre")) embedded.genre = primary.genre;
        if (writable("coverImagePath")) embedded.coverImagePath = coverImagePath;
        const item = await prisma.mediaItem.upsert({
          where: { libraryRootId_filePath: { libraryRootId: rootId, filePath: primary.filePath } },
          create: {
            libraryRootId: rootId,
            title: audiobookTitle(group),
            author: primary.author,
            narrator: primary.narrator,
            filePath: primary.filePath,
            fileFormat: primary.format,
            duration: group.reduce((total, file) => total + file.duration, 0),
            coverImagePath,
            releaseDate: primary.releaseDate,
            genre: primary.genre,
            chapters: group.length === 1 && primary.chapters ? JSON.stringify(primary.chapters) : null,
            metadataSource: "embedded",
          },
          update: {
            ...embedded,
            fileFormat: primary.format,
            duration: group.reduce((total, file) => total + file.duration, 0),
            chapters: group.length === 1 && primary.chapters ? JSON.stringify(primary.chapters) : null,
          },
        });

        await syncContributors(prisma, item.id, primary.author, primary.narrator);

        await prisma.track.deleteMany({ where: { mediaItemId: item.id } });
        if (group.length > 1) {
          // Spec 21: a hand-set track title outranks the embedded tag. Read
          // before the delete so the override survives the recreation -- this
          // is the only place a user's chapter name can be resurrected, since
          // the rows it lived on were just dropped.
          const trackTitleOverrides = parseTrackTitleOverrides(
            await prisma.fieldOverride.findMany({
              where: { mediaItemId: item.id, field: { startsWith: "trackTitle:" } },
              select: { field: true, value: true },
            }),
          );

          await prisma.track.createMany({
            data: group.map((file, index) => {
              const trackNumber = index + 1;
              return {
                mediaItemId: item.id,
                filePath: file.filePath,
                title: resolveTrackTitle(trackNumber, cleanTrackTitle(file.title), trackTitleOverrides),
                duration: file.duration,
                trackNumber,
                sizeBytes: BigInt(file.sizeBytes),
              };
            }),
          });
        }
      }

      const currentItemPaths = groupFiles(audioFiles).map((group) => group[0].filePath);
      // Books whose files are gone from disk are removed from the library.
      //
      // Children are deleted explicitly rather than relying on ON DELETE
      // CASCADE: Track, MetadataCandidate, ListeningHistory and
      // ContributorMediaItem were created by the original migration *without*
      // a cascade, so SQLite has them as RESTRICT and a bare delete of the
      // parent fails with a foreign-key error -- which is what happened the
      // first time a book actually disappeared from disk. schema.prisma now
      // declares Cascade for fresh databases, but an existing SQLite database
      // keeps RESTRICT and SQLite cannot ALTER a constraint, so the code has to
      // do this explicitly.
      const stale = await prisma.mediaItem.findMany({
        where: {
          libraryRootId: rootId,
          ...(currentItemPaths.length ? { filePath: { notIn: currentItemPaths } } : {}),
        },
        select: { id: true },
      });
      if (stale.length > 0) {
        const staleIds = stale.map((entry) => entry.id);
        // Only tables that actually reference MediaItem need clearing; the rest
        // cascade on their own.
        await prisma.track.deleteMany({ where: { mediaItemId: { in: staleIds } } });
        await prisma.metadataCandidate.deleteMany({ where: { mediaItemId: { in: staleIds } } });
        await prisma.listeningHistory.deleteMany({ where: { mediaItemId: { in: staleIds } } });
        await prisma.contributorMediaItem.deleteMany({ where: { mediaItemId: { in: staleIds } } });
        await prisma.mediaItem.deleteMany({ where: { id: { in: staleIds } } });
      }

      const completedAt = new Date();
      progress.set(rootId, { status: "complete", filesFound: audioFiles.length, lastScanAt: completedAt });
      await prisma.scanState.upsert({
        where: { libraryRootId: rootId },
        create: { libraryRootId: rootId, status: "complete", filesFound: audioFiles.length, lastScanAt: completedAt },
        update: { status: "complete", filesFound: audioFiles.length, lastScanAt: completedAt, message: null },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Scan failed";
      progress.set(rootId, { status: "error", filesFound: 0, message });
      await prisma.scanState.upsert({
        where: { libraryRootId: rootId },
        create: { libraryRootId: rootId, status: "error", message },
        update: { status: "error", message },
      });
      throw error;
    }
  }

  return {
    scanRoot,
    getProgress: (rootId: number) => progress.get(rootId),
  };
}