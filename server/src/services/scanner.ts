import fs from 'fs/promises';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import mm from 'music-metadata';
import ffmpeg from 'fluent-ffmpeg';

const prisma = new PrismaClient();

// Audio file extensions to scan for
const AUDIO_EXTENSIONS = ['.mp3', '.m4b', '.flac', '.ogg', '.wav', '.aac'];

interface ScanProgress {
  currentPath: string;
  filesScanned: number;
  itemsFound: number;
  errors: number;
}

export class ScannerService {
  private progress: ScanProgress = {
    currentPath: '',
    filesScanned: 0,
    itemsFound: 0,
    errors: 0,
  };

  getProgress() {
    return { ...this.progress };
  }

  resetProgress() {
    this.progress = {
      currentPath: '',
      filesScanned: 0,
      itemsFound: 0,
      errors: 0,
    };
  }

  /**
   * Scan all library roots and populate the database with audiobook metadata.
   */
  async scanAll(): Promise<void> {
    this.resetProgress();

    const roots = await prisma.libraryRoot.findMany();

    for (const root of roots) {
      try {
        // Update scan state
        await prisma.scanState.upsert({
          where: { libraryRootId: root.id },
          update: { status: 'scanning', lastScanAt: new Date(), message: null },
          create: {
            libraryRootId: root.id,
            status: 'scanning',
            filesFound: 0,
            lastScanAt: new Date(),
          },
        });

        await this.scanDirectory(root.path, root.id);

        // Mark complete
        await prisma.scanState.update({
          where: { libraryRootId: root.id },
          data: {
            status: 'complete',
            filesFound: this.progress.filesScanned,
            message: `Found ${this.progress.itemsFound} audiobook(s)`,
          },
        });
      } catch (error) {
        console.error(`Error scanning root ${root.path}:`, error);
        
        await prisma.scanState.upsert({
          where: { libraryRootId: root.id },
          update: { status: 'error', message: String(error) },
          create: {
            libraryRootId: root.id,
            status: 'error',
            filesFound: 0,
            message: String(error),
          },
        });
      }
    }
  }

  /**
   * Recursively scan a directory for audiobook files.
   */
  private async scanDirectory(dirPath: string, libraryRootId: number): Promise<void> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          // Recurse into subdirectories
          await this.scanDirectory(fullPath, libraryRootId);
        } else if (this.isAudioFile(entry.name)) {
          this.progress.filesScanned++;
          this.progress.currentPath = fullPath;

          try {
            const item = await this.processAudioFile(fullPath, libraryRootId);
            if (item) {
              this.progress.itemsFound++;
            }
          } catch (error) {
            console.warn(`Error processing ${fullPath}:`, error);
            this.progress.errors++;
          }
        }
      }
    } catch (error) {
      console.error(`Error reading directory ${dirPath}:`, error);
    }
  }

  /**
   * Process a single audio file: extract metadata, detect chapters, save to DB.
   */
  private async processAudioFile(filePath: string, libraryRootId: number): Promise<number | null> {
    const ext = path.extname(filePath).toLowerCase();
    const format = ext.replace('.', '');

    try {
      // Check if this file already exists in the database
      const existing = await prisma.mediaItem.findFirst({
        where: { filePath },
      });

      let mediaItemId: number;

      if (existing) {
        // Update existing entry
        await this.updateMediaItem(existing, ext);
        mediaItemId = existing.id;
      } else {
        // Create new entry
        const metadata = await mm.parseFile(filePath);
        
        const title = this.extractTitle(metadata);
        const author = this.extractArtist(metadata);
        const narrator = this.extractNarrator(metadata);

        // Extract album art if available
        let coverImagePath: string | null = null;
        if (metadata.common.picture && metadata.common.picture.length > 0) {
          const picture = metadata.common.picture[0];
          const ext = '.jpg';
          coverImagePath = path.join(
            path.dirname(filePath), 
            `${path.basename(filePath, path.extname(filePath))}-cover${ext}`
          );

          try {
            await fs.writeFile(coverImagePath, Buffer.from(picture.data));
          } catch (error) {
            console.warn(`Could not save cover art for ${filePath}:`, error);
            coverImagePath = null;
          }
        }

        // Try to detect duration with ffmpeg if metadata doesn't have it
        let duration = 0;
        if (metadata.format.duration) {
          duration = Math.round(metadata.format.duration * 1000) / 1000;
        } else {
          try {
            duration = await this.getDurationWithFFmpeg(filePath);
          } catch (error) {
            console.warn(`Could not get duration for ${filePath}:`, error);
          }
        }

        // Detect chapters from metadata or filename patterns
        const chapters = await this.detectChapters(metadata, filePath);

        const item = await prisma.mediaItem.create({
          data: {
            title,
            author,
            narrator,
            coverImagePath,
            releaseDate: metadata.common.date ? new Date(metadata.common.date) : null,
            genre: metadata.common.genre?.join(', '),
            filePath,
            fileFormat: format,
            duration,
            chapters: chapters ? JSON.stringify(chapters) : null,
            libraryRootId,
          },
        });

        mediaItemId = item.id;
      }

      // Extract contributor info and save to separate table
      const authorName = this.extractArtist(await mm.parseFile(filePath));
      if (authorName) {
        const contributor = await prisma.contributor.upsert({
          where: { id: 0 }, // Will always create new for simplicity in Phase 1
          update: {},
          create: { name: authorName, role: 'author' },
        });

        try {
          await prisma.contributorMediaItem.create({
            data: {
              contributorId: contributor.id,
              mediaItemId,
            },
          });
        } catch (error) {
          // Ignore duplicate key errors for now
        }
      }

      return mediaItemId;
    } catch (error) {
      console.error(`Error processing ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Update an existing media item with fresh metadata.
   */
  private async updateMediaItem(item: any, ext: string): Promise<void> {
    const filePath = item.filePath;
    
    try {
      const metadata = await mm.parseFile(filePath);
      
      // Extract updated fields
      let duration = item.duration;
      if (metadata.format.duration) {
        duration = Math.round(metadata.format.duration * 1000) / 1000;
      }

      // Check for chapters again in case file changed
      const chapters = await this.detectChapters(metadata, filePath);

      await prisma.mediaItem.update({
        where: { id: item.id },
        data: {
          title: this.extractTitle(metadata) || item.title,
          author: this.extractArtist(metadata) || item.author,
          narrator: this.extractNarrator(metadata) || item.narrator,
          duration,
          chapters: chapters ? JSON.stringify(chapters) : null,
        },
      });
    } catch (error) {
      console.warn(`Could not update ${filePath}:`, error);
    }
  }

  /**
   * Extract title from metadata with fallbacks.
   */
  private extractTitle(metadata: mm.IAudioMetadata): string {
    // Try various common fields in order of preference
    if (metadata.common.title) return metadata.common.title;
    if (metadata.common.album) return metadata.common.album;
    
    // Fallback to filename without extension and track number prefix
    const fileName = path.basename(metadata.format.filename || '');
    const cleanName = fileName.replace(/\.\w+$/, '').replace(/^\d+\s*/, '');
    return cleanName || 'Unknown Title';
  }

  /**
   * Extract artist/author from metadata.
   */
  private extractArtist(metadata: mm.IAudioMetadata): string {
    if (metadata.common.artist) return metadata.common.artist;
    if (metadata.common.albumartist) return metadata.common.albumartist;
    return 'Unknown Author';
  }

  /**
   * Extract narrator from metadata.
   */
  private extractNarrator(metadata: mm.IAudioMetadata): string | null {
    // Check common fields first
    if (metadata.common.performer) return metadata.common.performer;
    
    // Try extended metadata
    const ext = metadata.format as any;
    if (ext['narrator']) return ext['narrator'];

    return null;
  }

  /**
   * Detect chapters from ID3 tags or filename patterns.
   */
  private async detectChapters(metadata: mm.IAudioMetadata, filePath: string): Promise<any[] | null> {
    // Check for CHAP atom in MP4/M4B files
    const ext = metadata.format as any;
    
    if (ext['chapter']) {
      return ext['chapter'].map((ch: any) => ({
        start: ch.start,
        end: ch.end,
        title: ch.title || `Chapter ${this.progress.filesScanned}`,
      }));
    }

    // Check for chapter markers in ID3 frames
    if (metadata.common.chapters) {
      return metadata.common.chapters.map((ch: any) => ({
        start: ch.start,
        end: ch.end,
        title: ch.title || `Chapter ${this.progress.filesScanned}`,
      }));
    }

    // Fallback: detect chapter from filename patterns like "Book_01.mp3", "Ch. 5 - Title.mp3"
    const fileName = path.basename(filePath);
    
    // Try to match various chapter naming conventions
    const multiFileMatch = fileName.match(/^(\d+)[_.-]/i) || 
                          fileName.match(/chapter[_\s]*(\d+)/i) ||
                          fileName.match(/ch\.?\s*(\d+)/i);

    if (multiFileMatch) {
      return [{
        start: 0,
        end: null, // Single file with chapter number - duration unknown until playback
        title: `Chapter ${multiFileMatch[1]}`,
      }];
    }

    return null;
  }

  /**
   * Get audio duration using ffmpeg (more reliable for some formats).
   */
  private getDurationWithFFmpeg(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          reject(err);
        } else {
          const duration = Math.round(metadata.format.duration * 1000) / 1000;
          resolve(duration);
        }
      });
    });
  }

  /**
   * Check if a filename has an audio extension.
   */
  private isAudioFile(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase();
    return AUDIO_EXTENSIONS.includes(ext);
  }
}