-- Spec 16: provider expansion + background enrichment.
-- Additive only. SQLite today, PostgreSQL-compatible later: no SQLite-only SQL.

-- Widen MetadataCandidate so a candidate can carry the full audiobook tag
-- suite. Spec 07's shape could not hold narrator/series/genre, so applying a
-- candidate silently dropped them.
ALTER TABLE MetadataCandidate ADD COLUMN narrators TEXT;          -- JSON array of strings
ALTER TABLE MetadataCandidate ADD COLUMN seriesName TEXT;
ALTER TABLE MetadataCandidate ADD COLUMN seriesPosition REAL;
ALTER TABLE MetadataCandidate ADD COLUMN publisher TEXT;
ALTER TABLE MetadataCandidate ADD COLUMN publishedYear INTEGER;
ALTER TABLE MetadataCandidate ADD COLUMN language TEXT;
ALTER TABLE MetadataCandidate ADD COLUMN genres TEXT;             -- JSON array of strings
ALTER TABLE MetadataCandidate ADD COLUMN providerKey TEXT;        -- ASIN, LibriVox project id, etc.

-- Stable identity for a candidate from a provider, so re-running enrichment
-- can dedupe instead of stacking duplicates.
CREATE UNIQUE INDEX MetadataCandidate_providerKey
  ON MetadataCandidate(mediaItemId, source, providerKey);

-- A resumable background enrichment pass. Progress lives in the DB so it
-- survives a server restart mid-run.
CREATE TABLE EnrichmentRun (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending | running | complete | error
  queued      INTEGER NOT NULL DEFAULT 0,
  processed   INTEGER NOT NULL DEFAULT 0,
  applied     INTEGER NOT NULL DEFAULT 0,
  review      INTEGER NOT NULL DEFAULT 0,
  failed      INTEGER NOT NULL DEFAULT 0,
  skipped     INTEGER NOT NULL DEFAULT 0,
  message     TEXT,
  startedAt   DATETIME,
  finishedAt  DATETIME,
  createdAt   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE EnrichmentItem (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  runId       INTEGER NOT NULL,
  mediaItemId INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | applied | review | skipped | failed
  provider    TEXT,
  confidence  REAL,
  message     TEXT,
  createdAt   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (runId) REFERENCES EnrichmentRun(id) ON DELETE CASCADE,
  FOREIGN KEY (mediaItemId) REFERENCES MediaItem(id) ON DELETE CASCADE
);

CREATE INDEX EnrichmentItem_runId ON EnrichmentItem(runId);
CREATE INDEX EnrichmentItem_mediaItemId ON EnrichmentItem(mediaItemId);

-- Spec 16 needs to know, per book, whether it still needs enrichment, and to
-- distinguish "needs review" from "done". Kept on MediaItem so the run can
-- cheaply select its work queue with an index.
ALTER TABLE MediaItem ADD COLUMN enrichmentStatus TEXT;   -- null | pending | applied | review | skipped | failed
ALTER TABLE MediaItem ADD COLUMN enrichedAt DATETIME;

CREATE INDEX MediaItem_enrichmentStatus ON MediaItem(enrichmentStatus);