-- Spec 18: favourites & custom tags.
-- Additive only. SQLite today, PostgreSQL-compatible later.

-- Favourites are per profile: one household member's favourites never leak
-- into another's, and recommendations (spec 19) are seeded per profile.
CREATE TABLE Favourite (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  profileId   INTEGER NOT NULL,
  mediaItemId INTEGER NOT NULL,
  createdAt   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (profileId) REFERENCES Profile(id) ON DELETE CASCADE,
  FOREIGN KEY (mediaItemId) REFERENCES MediaItem(id) ON DELETE CASCADE,
  -- Makes favouriting idempotent and prevents a double-tap creating two rows.
  UNIQUE (profileId, mediaItemId)
);

-- Speeds the "this profile's favourites" lookup and the cascade delete.
CREATE INDEX Favourite_profileId ON Favourite(profileId);
CREATE INDEX Favourite_mediaItemId ON Favourite(mediaItemId);

-- Custom tags are a household-wide *managed vocabulary*, not free text. Tags
-- are created once and assigned to many books, which is what prevents the
-- "great"/"GREAT"/"good" sprawl a free-text field invites.
CREATE TABLE Tag (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL,
  -- Lowercased name. Case-insensitive uniqueness without PostgreSQL-only
  -- filters, matching the Series.key approach in spec 17.
  key       TEXT NOT NULL UNIQUE,
  -- Optional: which profile created it. Kept for provenance/audit only;
  -- visibility is household-wide.
  createdBy INTEGER,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (createdBy) REFERENCES Profile(id) ON DELETE SET NULL
);

CREATE TABLE MediaItemTag (
  mediaItemId INTEGER NOT NULL,
  tagId       INTEGER NOT NULL,
  source      TEXT NOT NULL DEFAULT 'user', -- user
  createdAt   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (mediaItemId) REFERENCES MediaItem(id) ON DELETE CASCADE,
  FOREIGN KEY (tagId) REFERENCES Tag(id) ON DELETE CASCADE,
  PRIMARY KEY (mediaItemId, tagId)
);

CREATE INDEX MediaItemTag_tagId ON MediaItemTag(tagId);