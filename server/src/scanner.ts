import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import ffmpeg from "fluent-ffmpeg";
import { execFile } from "node:child_process";
import * as musicMetadata from "music-metadata";
import { PrismaClient } from "@prisma/client";
import { groupFiles, audiobookTitle, titleFromFilename, isAudioFile } from "./scan-utils";

export const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".m4b", ".flac", ".ogg", ".wav", ".aac"]);

type AudioFile = {
  filePath: string;
  format: string;
  title: string;
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
          select: { metadataSource: true },
        });
        const userOverride = existingRow?.metadataSource === "user";
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
            ...(userOverride ? {} : { title: audiobookTitle(group), author: primary.author, narrator: primary.narrator, releaseDate: primary.releaseDate, genre: primary.genre, coverImagePath, metadataSource: "embedded" }),
            fileFormat: primary.format,
            duration: group.reduce((total, file) => total + file.duration, 0),
            chapters: group.length === 1 && primary.chapters ? JSON.stringify(primary.chapters) : null,
          },
        });

        await syncContributors(prisma, item.id, primary.author, primary.narrator);

        await prisma.track.deleteMany({ where: { mediaItemId: item.id } });
        if (group.length > 1) {
          await prisma.track.createMany({
            data: group.map((file, index) => ({
              mediaItemId: item.id,
              filePath: file.filePath,
              title: file.title,
              duration: file.duration,
              trackNumber: index + 1,
              sizeBytes: BigInt(file.sizeBytes),
            })),
          });
        }
      }

      const currentItemPaths = groupFiles(audioFiles).map((group) => group[0].filePath);
      await prisma.mediaItem.deleteMany({
        where: {
          libraryRootId: rootId,
          ...(currentItemPaths.length ? { filePath: { notIn: currentItemPaths } } : {}),
        },
      });

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