export interface Track {
  id: number;
  filePath?: string;
  title?: string;
  duration: number;
  trackNumber: number;
}

/** Profile-scoped saved position, added by spec 14 for the library grid. */
export interface BookProgress {
  position: number;
  completed: boolean;
  lastPlayed: string;
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
  chapters?: string | null;
  tracks: Track[];
  createdAt: string;
  /** Null when the book has never been played, or no profile is selected. */
  progress?: BookProgress | null;
}

export interface LibraryRoot {
  id: number;
  path: string;
  label?: string;
  scanState?: { status: string; filesFound: number; message?: string };
}
