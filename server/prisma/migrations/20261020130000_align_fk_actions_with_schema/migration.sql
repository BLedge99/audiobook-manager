-- Align the foreign-key actions with the Prisma schema.
--
-- ## Why this migration exists
--
-- The migration files and `prisma/schema.prisma` had drifted apart, and
-- `prisma db push` in dev hid it for the life of the project.
--
-- `db push` builds the database from the **schema file**; `migrate deploy`
-- builds it from the **migration files**. They disagreed on three referential
-- actions:
--
-- | Table               | Schema | Migrations | Effect in production        |
-- |---------------------|--------|------------|-----------------------------|
-- | `Track`             | CASCADE| RESTRICT   | deleting a book fails        |
-- | `ListeningHistory`  | CASCADE| RESTRICT   | deleting a book fails        |
-- | `MetadataCandidate` | CASCADE| RESTRICT   | deleting a book fails        |
--
-- SQLite applies RESTRICT to a relation with no `onDelete`, and the original
-- migrations omitted it. The schema was corrected -- the `Track` model still
-- carries the note: *"The original migration omitted onDelete, which SQLite
-- applies as RESTRICT, so deleting a book whose files left the disk failed
-- with a foreign-key error"* -- but **the migration was never corrected to
-- match**, so the fix only ever reached development databases.
--
-- The visible symptom in production: removing a library folder deletes the
-- root, which cascades to its books, which then failed because their tracks
-- still pointed at them. In development the same action worked, because
-- `db push` had built the database from the corrected schema.
--
-- ## How
--
-- SQLite cannot alter a foreign key in place, so each table is rebuilt: new
-- table, copy the rows, drop the old one, rename. The DDL below is copied
-- verbatim from the schema-accurate form, so it cannot drift from the schema
-- by typo.
--
-- The `PRAGMA foreign_keys` toggles are required by the rebuild: with foreign
-- keys on, dropping the old table would trip its own constraint. The pragma
-- is a no-op inside a transaction, and Prisma executes SQLite migrations
-- statement by statement rather than wrapping them, so it takes effect.

PRAGMA foreign_keys=OFF;

-- RedefineTable: Track
CREATE TABLE "new_Track" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "mediaItemId" INTEGER NOT NULL,
    "filePath" TEXT NOT NULL,
    "title" TEXT,
    "duration" REAL NOT NULL,
    "trackNumber" INTEGER NOT NULL,
    "sizeBytes" BIGINT,
    CONSTRAINT "Track_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Track" ("id", "mediaItemId", "filePath", "title", "duration", "trackNumber", "sizeBytes")
  SELECT "id", "mediaItemId", "filePath", "title", "duration", "trackNumber", "sizeBytes" FROM "Track";
DROP TABLE "Track";
ALTER TABLE "new_Track" RENAME TO "Track";

-- RedefineTable: ListeningHistory
CREATE TABLE "new_ListeningHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "mediaItemId" INTEGER NOT NULL,
    "profileId" INTEGER,
    "position" REAL NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "lastPlayed" DATETIME NOT NULL,
    "playedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ListeningHistory_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ListeningHistory_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ListeningHistory" ("id", "mediaItemId", "profileId", "position", "completed", "lastPlayed", "playedAt")
  SELECT "id", "mediaItemId", "profileId", "position", "completed", "lastPlayed", "playedAt" FROM "ListeningHistory";
DROP TABLE "ListeningHistory";
ALTER TABLE "new_ListeningHistory" RENAME TO "ListeningHistory";

-- RedefineTable: MetadataCandidate
CREATE TABLE "new_MetadataCandidate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "mediaItemId" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "coverUrl" TEXT,
    "description" TEXT,
    "confidence" REAL,
    "raw" TEXT,
    "narrators" TEXT,
    "seriesName" TEXT,
    "seriesPosition" REAL,
    "publisher" TEXT,
    "publishedYear" INTEGER,
    "language" TEXT,
    "genres" TEXT,
    "providerKey" TEXT,
    CONSTRAINT "MetadataCandidate_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_MetadataCandidate" ("id", "mediaItemId", "source", "title", "author", "coverUrl", "description", "confidence", "raw", "narrators", "seriesName", "seriesPosition", "publisher", "publishedYear", "language", "genres", "providerKey")
  SELECT "id", "mediaItemId", "source", "title", "author", "coverUrl", "description", "confidence", "raw", "narrators", "seriesName", "seriesPosition", "publisher", "publishedYear", "language", "genres", "providerKey" FROM "MetadataCandidate";
DROP TABLE "MetadataCandidate";
ALTER TABLE "new_MetadataCandidate" RENAME TO "MetadataCandidate";

-- The unique index on (mediaItemId, profileId) lives outside the table
-- definition, so it has to be recreated after the rebuild.
DROP INDEX IF EXISTS "ListeningHistory_mediaItemId_profileId_key";
CREATE UNIQUE INDEX "ListeningHistory_mediaItemId_profileId_key" ON "ListeningHistory"("mediaItemId", "profileId");

PRAGMA foreign_keys=ON;
