import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import ffmpeg from "fluent-ffmpeg";
import * as musicMetadata from "music-metadata";
import { PrismaClient } from "@prisma/client";

const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".m4b", ".flac", ".ogg", ".wav", ".aac"]);

type AudioFile = {
  filePath: string;
  format: string;
  title: string;
  author: string;
  narrator?: string;
  duration: number;
  sizeBytes: number;
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
    } else if (entry.isFile() && AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
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

async function readAudioFile(filePath: string): Promise<AudioFile> {
  const metadata = await parseAudioFile(filePath);
  const fileStats = await stat(filePath);
  const common = metadata.common;
  const picture = common.picture?.[0];
  const title = common.title?.trim() || path.basename(filePath, path.extname(filePath));

  return {
    filePath,
    format: path.extname(filePath).slice(1).toLowerCase(),
    title,
    author: firstTagValue(common.artist) || firstTagValue(common.albumartist) || "Unknown author",
    narrator: firstTagValue(common.composer),
    duration: (await probeDuration(filePath)) || metadata.format.duration || 0,
    sizeBytes: fileStats.size,
    cover: picture ? { data: picture.data, format: picture.format } : undefined,
  };
}

function groupFiles(files: AudioFile[]): AudioFile[][] {
  const groups = new Map<string, AudioFile[]>();
  for (const file of files) {
    const directory = path.dirname(file.filePath);
    const group = groups.get(directory) || [];
    group.push(file);
    groups.set(directory, group);
  }
  return [...groups.values()];
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

function audiobookTitle(group: AudioFile[]): string {
  if (group.length === 1) return group[0].title;
  return path.basename(path.dirname(group[0].filePath));
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
        const coverImagePath = await saveCover(primary, "/app/data/covers");
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
            metadataSource: "embedded",
          },
          update: {
            title: audiobookTitle(group),
            author: primary.author,
            narrator: primary.narrator,
            fileFormat: primary.format,
            duration: group.reduce((total, file) => total + file.duration, 0),
            coverImagePath,
            metadataSource: "embedded",
          },
        });

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