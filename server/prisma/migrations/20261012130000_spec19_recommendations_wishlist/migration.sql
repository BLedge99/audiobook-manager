-- Spec 19: recommendations & wishlist.
-- Additive only. SQLite today, PostgreSQL-compatible later.

-- Books the household does NOT own. Media is a read-only mount, so these are
-- metadata-only rows: there is no filePath, no Track and no playback route.
-- That is the structural reason they can never become playable by accident.
CREATE TABLE WishlistItem (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  profileId       INTEGER NOT NULL,
  title           TEXT NOT NULL,
  author          TEXT,
  -- JSON array of strings; providers disagree on singular vs plural.
  narrators       TEXT,
  description     TEXT,
  -- Local copy under COVER_DIR. External books have no local file, so this is
  -- always an app-data path, never a library path.
  coverPath       TEXT,
  coverUrl        TEXT,
  genres          TEXT,   -- JSON array of taxonomy genre slugs
  seriesName      TEXT,
  publisher       TEXT,
  publishedYear   INTEGER,
  provider        TEXT,   -- audnexus | librivox | googlebooks | openlibrary
  providerKey     TEXT,   -- ASIN etc, for dedupe across refreshes
  -- Which owned book seeded this suggestion, for "because you liked X".
  seedMediaItemId INTEGER,
  -- "I got this" marker. Flags the title for enrichment when it next appears
  -- in a scan.
  owned           INTEGER NOT NULL DEFAULT 0,
  createdAt       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (profileId) REFERENCES Profile(id) ON DELETE CASCADE,
  FOREIGN KEY (seedMediaItemId) REFERENCES MediaItem(id) ON DELETE SET NULL,
  -- A given external book should appear once per profile, not once per
  -- refresh or per seed.
  UNIQUE (profileId, provider, providerKey)
);

CREATE INDEX WishlistItem_profileId ON WishlistItem(profileId);
CREATE INDEX WishlistItem_seedMediaItemId ON WishlistItem(seedMediaItemId);