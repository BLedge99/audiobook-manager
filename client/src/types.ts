export interface Track {
  id: number;
  filePath?: string;
  title?: string;
  duration: number;
  trackNumber: number;
}

export interface Audiobook {
  id: number;
  title: string;
  author: string;
  narrator?: string;
  description?: string;
  coverImagePath?: string;
  duration: number;
  fileFormat: string;
  filePath: string;
  tracks: Track[];
  createdAt: string;
}

export interface LibraryRoot {
  id: number;
  path: string;
  label?: string;
  scanState?: { status: string; filesFound: number; message?: string };
}
