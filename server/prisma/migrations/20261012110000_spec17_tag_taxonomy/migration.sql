-- Spec 17: tag & taxonomy model.
-- Additive only. SQLite today, PostgreSQL-compatible later: no SQLite-only SQL.
--
-- Replaces the all-or-nothing `metadataSource = "user"` sentinel with explicit
-- per-field override rows (ADR 009).

-- Spec 17: which fields a human actually set. Only these are protected from
-- the scanner and from re-enrichment, so fixing a narrator no longer freezes
-- the title.
CREATE TABLE FieldOverride (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  mediaItemId INTEGER NOT NULL,
  field       TEXT NOT NULL,           -- title, author, narrator, description, ...
  value       TEXT NOT NULL,
  createdAt   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (mediaItemId) REFERENCES MediaItem(id) ON DELETE CASCADE,
  -- One override per field per book; re-setting replaces.
  UNIQUE (mediaItemId, field)
);

CREATE INDEX FieldOverride_mediaItemId ON FieldOverride(mediaItemId);

-- Spec 17: curated two-level genre taxonomy. Deliberately a real table rather
-- than a JSON column: it must be queryable ("every book in this genre") and it
-- ports to PostgreSQL unchanged.
CREATE TABLE Genre (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  slug      TEXT NOT NULL UNIQUE,
  name      TEXT NOT NULL,
  parentId  INTEGER,                  -- NULL = top level
  sortOrder INTEGER NOT NULL DEFAULT 0,
  -- "Misc" is the catch-all bucket so an unmapped provider genre is never
  -- silently dropped from the browse view.
  isCatchAll INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (parentId) REFERENCES Genre(id) ON DELETE SET NULL
);

CREATE INDEX Genre_parentId ON Genre(parentId);

-- Maps a provider's raw genre string onto the taxonomy. Editable so the
-- operator can correct a bad mapping without a code change.
CREATE TABLE GenreMapping (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  provider   TEXT NOT NULL,           -- audnexus | librivox | googlebooks | openlibrary
  rawValue   TEXT NOT NULL,           -- provider's own string, e.g. "Mystery, Thriller & Suspense"
  genreId    INTEGER NOT NULL,
  FOREIGN KEY (genreId) REFERENCES Genre(id) ON DELETE CASCADE,
  UNIQUE (provider, rawValue)
);

CREATE TABLE MediaItemGenre (
  mediaItemId INTEGER NOT NULL,
  genreId     INTEGER NOT NULL,
  source      TEXT NOT NULL DEFAULT 'provider',  -- provider | user
  FOREIGN KEY (mediaItemId) REFERENCES MediaItem(id) ON DELETE CASCADE,
  FOREIGN KEY (genreId) REFERENCES Genre(id) ON DELETE CASCADE,
  PRIMARY KEY (mediaItemId, genreId)
);

CREATE INDEX MediaItemGenre_genreId ON MediaItemGenre(genreId);

-- Spec 17: series with reading order. Normalised so "Dune" groups consistently
-- regardless of which provider spelled it how.
--
-- `key` is the lowercased, punctuation-stripped form of `name`. It exists
-- because Prisma's `mode: "insensitive"` is PostgreSQL-only, and migrations
-- must stay portable (AGENTS.md). A normalized column keeps the lookup an
-- indexed equality rather than a full-table scan in application code.
CREATE TABLE Series (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  key  TEXT NOT NULL UNIQUE
);

-- Float, not int: Audnexus emits interstitial novellas as 1.5 / 2.5, which
-- must sort between the surrounding books.
ALTER TABLE MediaItem ADD COLUMN seriesId INTEGER
  REFERENCES Series(id) ON DELETE SET NULL;
ALTER TABLE MediaItem ADD COLUMN seriesPosition REAL;
CREATE INDEX MediaItem_seriesId ON MediaItem(seriesId);

-- Spec 17: publication facts.
ALTER TABLE MediaItem ADD COLUMN publisher TEXT;
ALTER TABLE MediaItem ADD COLUMN publishedYear INTEGER;
ALTER TABLE MediaItem ADD COLUMN language TEXT;
ALTER TABLE MediaItem ADD COLUMN unabridged INTEGER NOT NULL DEFAULT 0;

-- Spec 17: the subtitle Audnexus splits out, and its author/narrator
-- disambiguation, so the detail view can show the full tag suite.
ALTER TABLE MediaItem ADD COLUMN subtitle TEXT;
ALTER TABLE MediaItem ADD COLUMN publisherSeries TEXT;

-- `genre` on MediaItem becomes the legacy embedded comma-separated string.
-- Spec 17 supersedes it with MediaItemGenre; the column is retained for one
-- release so an older build can still read the DB, then dropped.