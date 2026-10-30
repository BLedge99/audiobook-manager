export interface Track {
  id: number;
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

/** Spec 17: a taxonomy genre assigned to a book. */
export interface BookGenre {
  id: number;
  slug: string;
  name: string;
  parentId?: number | null;
  /** `user` assignments survive re-enrichment; `provider` ones do not. */
  source: string;
}

/** Spec 17: series with fractional reading order. */
export interface BookSeries {
  id: number;
  name: string;
}

export interface BookContributor {
  id: number;
  name: string;
  role: string;
}

export interface BookTag {
  id: number;
  name: string;
}

export interface Audiobook {
  id: number;
  title: string;
  author: string;
  /** Comma-joined for display; `contributors` holds one row per narrator. */
  narrator?: string;
  description?: string;
  duration: number;
  fileFormat: string;
  chapters?: string | null;
  tracks: Track[];
  createdAt: string;
  /** Null when the book has never been played, or no profile is selected. */
  progress?: BookProgress | null;
  // Spec 17 tag suite
  subtitle?: string | null;
  publisher?: string | null;
  publishedYear?: number | null;
  releaseDate?: string | null;
  language?: string | null;
  unabridged?: boolean;
  isbn?: string | null;
  series?: BookSeries | null;
  seriesPosition?: number | null;
  genres?: BookGenre[];
  customTags?: BookTag[];
  contributors?: BookContributor[];
  /** Which provider supplied the current values (spec 16 provenance). */
  metadataSource?: string | null;
  /** null | pending | applied | review | skipped | failed (spec 16). */
  enrichmentStatus?: string | null;
  /** True when the current profile has favourited this book (spec 18). */
  favourited?: boolean;
  /**
   * Spec 27: is this book in the calling profile's library?
   *
   * Only the `/api/server-library` payload carries it. The library listing
   * does not need it -- everything in that list is in the library by
   * definition.
   */
  inLibrary?: boolean;
  /**
   * Spec 30: the server origin this book belongs to, when it came from the
   * device's offline library (a per-server shelf) rather than from the
   * currently connected server. Absent for books read from the connected
   * server's catalogue, which belong to that server by construction.
   */
  serverId?: string;
}

export interface LibraryRoot {
  id: number;
  path: string;
  label?: string;
  scanState?: { status: string; filesFound: number; message?: string };
}

// --- Spec 17/18 taxonomy -------------------------------------------------

export interface GenreNode {
  id: number;
  slug: string;
  name: string;
  parentId?: number | null;
  isCatchAll?: boolean;
  count?: number;
  children?: GenreNode[];
}

export interface TagSummary {
  id: number;
  name: string;
  count: number;
}

/** What the tag-suite editor fetches for one book (spec 17). */
export interface BookTagSuite {
  id: number;
  title: string;
  subtitle: string | null;
  author: string;
  description: string | null;
  publisher: string | null;
  publishedYear: number | null;
  language: string | null;
  unabridged: boolean;
  isbn: string | null;
  series: { id: number; name: string; position: number | null } | null;
  genres: { id: number; slug: string; name: string; parent: string | null; source: string }[];
  contributors: { id: number; name: string; role: string }[];
  metadataSource: string | null;
  enrichmentStatus: string | null;
  /** Field names a human has overridden, so the UI can mark them as theirs. */
  overriddenFields: string[];
}

// --- Spec 19 Discover ----------------------------------------------------

/** Why a recommendation was offered. The server sends the code and values. */
export type RecommendationReason =
  | { code: "shared-genre"; genre: string }
  | { code: "favourite-author"; author: string }
  | { code: "series"; series: string }
  | { code: "related" };

/** A non-ok Discover status, as a code the client renders. */
export type DiscoverMessageCode =
  | "seed-needs-details"
  | "favourites-need-details"
  | "favourites-not-enough-metadata"
  | "no-similar-books"
  | "no-new-books";

export interface DiscoverMessage {
  code: DiscoverMessageCode;
}

export interface Recommendation {
  title: string;
  author?: string;
  narrators: string[];
  description?: string;
  coverUrl?: string;
  genres: string[];
  seriesName?: string;
  publisher?: string;
  publishedYear?: number;
  provider: string;
  providerKey?: string;
  score: number;
  reason: RecommendationReason;
}

export type DiscoverStatus = "ok" | "offline" | "insufficient-metadata" | "no-results";

export interface DiscoverResult {
  status: DiscoverStatus;
  recommendations: Recommendation[];
  message?: DiscoverMessage;
  seedTitle?: string;
  seededFrom?: { genres: string[]; authors: string[]; series: string[]; bookCount: number };
  /** 1-based page, echoed back so the client can tell where it is. */
  page?: number;
  pageSize?: number;
  /** Whether the server has another page. Drives the "Show more" control. */
  hasMore?: boolean;
  /** Ranked results in total, not just on this page. */
  total?: number;
}

export interface WishlistItem {
  id: number;
  title: string;
  author: string | null;
  narrators: string[];
  description: string | null;
  coverUrl: string | null;
  genres: string[];
  seriesName: string | null;
  publisher: string | null;
  publishedYear: number | null;
  provider: string | null;
  seedMediaItemId: number | null;
  owned: boolean;
  createdAt: string;
  /** Always false: wishlist books are metadata-only (spec 19). */
  playable: false;
}

// --- Spec 16 enrichment ---------------------------------------------------

export interface EnrichmentStatus {
  runId: number | null;
  status: string;
  queued: number;
  processed: number;
  applied: number;
  review: number;
  failed: number;
  skipped: number;
  message: string | null;
}