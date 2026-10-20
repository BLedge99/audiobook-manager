-- Spec 27: per-profile library membership.
-- Additive only. SQLite today, PostgreSQL-compatible later.
--
-- Two things happen here and they are deliberately different:
--
-- 1. The new table and the new column. Purely additive.
--
-- 2. The DATA migration. Every profile that exists today is given every book
--    that exists today, and is marked as following the server library.
--
-- The data migration is the whole point of the asymmetry the spec describes.
-- Shipping this feature must change nothing for a household that already has
-- the app: their library does not silently empty on upgrade. A profile created
-- *after* this migration starts empty and does not follow the server library,
-- which is the behaviour the spec calls for and which the profile creation
-- path in `app.ts` implements.
--
-- The `followsServerLibrary` flag is what makes "existing" mean something
-- after the migration. Without it, a book scanned next month would have to be
-- added to every profile by hand, and a fresh install would behave differently
-- from a migrated one.

CREATE TABLE ProfileLibraryEntry (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  profileId   INTEGER NOT NULL,
  mediaItemId INTEGER NOT NULL,
  createdAt   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_library_entry_profile FOREIGN KEY (profileId) REFERENCES Profile (id) ON DELETE CASCADE,
  CONSTRAINT fk_library_entry_media_item FOREIGN KEY (mediaItemId) REFERENCES MediaItem (id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX ProfileLibraryEntry_profileId_mediaItemId_key ON ProfileLibraryEntry (profileId, mediaItemId);
CREATE INDEX ProfileLibraryEntry_profileId_idx ON ProfileLibraryEntry (profileId);
CREATE INDEX ProfileLibraryEntry_mediaItemId_idx ON ProfileLibraryEntry (mediaItemId);

-- The flag itself. The default is false: a profile created from now on does
-- not follow the server library. The UPDATE below flips it for the profiles
-- that already exist.
ALTER TABLE Profile ADD COLUMN followsServerLibrary BOOLEAN NOT NULL DEFAULT false;

-- Every existing profile follows the server library from now on.
UPDATE Profile SET followsServerLibrary = true;

-- ...and every existing profile gets every book that exists today.
INSERT INTO ProfileLibraryEntry (profileId, mediaItemId, createdAt)
SELECT p.id, m.id, CURRENT_TIMESTAMP
FROM Profile p
CROSS JOIN MediaItem m
WHERE NOT EXISTS (
  SELECT 1 FROM ProfileLibraryEntry e
  WHERE e.profileId = p.id AND e.mediaItemId = m.id
);
