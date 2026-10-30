-- CreateTable
CREATE TABLE "LibraryRoot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "path" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "MediaItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "narrator" TEXT,
    "description" TEXT,
    "coverImagePath" TEXT,
    "coverImageUrl" TEXT,
    "releaseDate" DATETIME,
    "genre" TEXT,
    "isbn" TEXT,
    "asin" TEXT,
    "filePath" TEXT NOT NULL,
    "fileFormat" TEXT NOT NULL,
    "duration" REAL NOT NULL DEFAULT 0,
    "chapters" TEXT,
    "metadataSource" TEXT,
    "metadataConfidence" REAL,
    "enrichmentStatus" TEXT,
    "enrichedAt" DATETIME,
    "subtitle" TEXT,
    "seriesId" INTEGER,
    "seriesPosition" REAL,
    "publisher" TEXT,
    "publishedYear" INTEGER,
    "language" TEXT,
    "unabridged" BOOLEAN NOT NULL DEFAULT false,
    "libraryRootId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MediaItem_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MediaItem_libraryRootId_fkey" FOREIGN KEY ("libraryRootId") REFERENCES "LibraryRoot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Track" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "mediaItemId" INTEGER NOT NULL,
    "filePath" TEXT NOT NULL,
    "title" TEXT,
    "duration" REAL NOT NULL,
    "trackNumber" INTEGER NOT NULL,
    "sizeBytes" BIGINT,
    CONSTRAINT "Track_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Contributor" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ContributorMediaItem" (
    "contributorId" INTEGER NOT NULL,
    "mediaItemId" INTEGER NOT NULL,

    PRIMARY KEY ("contributorId", "mediaItemId"),
    CONSTRAINT "ContributorMediaItem_contributorId_fkey" FOREIGN KEY ("contributorId") REFERENCES "Contributor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ContributorMediaItem_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MetadataCandidate" (
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

-- CreateTable
CREATE TABLE "FieldOverride" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "mediaItemId" INTEGER NOT NULL,
    "field" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FieldOverride_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Genre" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isCatchAll" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Genre_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Genre" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GenreMapping" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "provider" TEXT NOT NULL,
    "rawValue" TEXT NOT NULL,
    "genreId" INTEGER NOT NULL,
    CONSTRAINT "GenreMapping_genreId_fkey" FOREIGN KEY ("genreId") REFERENCES "Genre" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MediaItemGenre" (
    "mediaItemId" INTEGER NOT NULL,
    "genreId" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'provider',

    PRIMARY KEY ("mediaItemId", "genreId"),
    CONSTRAINT "MediaItemGenre_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MediaItemGenre_genreId_fkey" FOREIGN KEY ("genreId") REFERENCES "Genre" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Favourite" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "profileId" INTEGER NOT NULL,
    "mediaItemId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Favourite_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Favourite_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProfileLibraryEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "profileId" INTEGER NOT NULL,
    "mediaItemId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProfileLibraryEntry_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProfileLibraryEntry_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "createdBy" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Tag_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "Profile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MediaItemTag" (
    "mediaItemId" INTEGER NOT NULL,
    "tagId" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'user',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("mediaItemId", "tagId"),
    CONSTRAINT "MediaItemTag_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MediaItemTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WishlistItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "profileId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "narrators" TEXT,
    "description" TEXT,
    "coverPath" TEXT,
    "coverUrl" TEXT,
    "genres" TEXT,
    "seriesName" TEXT,
    "publisher" TEXT,
    "publishedYear" INTEGER,
    "provider" TEXT,
    "providerKey" TEXT,
    "seedMediaItemId" INTEGER,
    "owned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WishlistItem_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WishlistItem_seedMediaItemId_fkey" FOREIGN KEY ("seedMediaItemId") REFERENCES "MediaItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Series" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "EnrichmentRun" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "queued" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "applied" INTEGER NOT NULL DEFAULT 0,
    "review" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "EnrichmentItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "runId" INTEGER NOT NULL,
    "mediaItemId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "provider" TEXT,
    "confidence" REAL,
    "message" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EnrichmentItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "EnrichmentRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EnrichmentItem_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ListeningHistory" (
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

-- CreateTable
CREATE TABLE "Profile" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "passwordHash" TEXT,
    "passwordUpdatedAt" DATETIME,
    "role" TEXT NOT NULL DEFAULT 'member',
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "lastLoginAt" DATETIME,
    "followsServerLibrary" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "profileId" INTEGER,
    "via" TEXT NOT NULL,
    "userAgent" TEXT,
    "deviceLabel" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    CONSTRAINT "Session_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DeviceCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" INTEGER NOT NULL,
    "secretHash" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    CONSTRAINT "DeviceCredential_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WebAuthnCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" INTEGER NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "transports" TEXT,
    "backedUp" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME,
    CONSTRAINT "WebAuthnCredential_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WebAuthnChallenge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" INTEGER,
    "challenge" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "WebAuthnChallenge_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlaySession" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "profileId" INTEGER NOT NULL,
    "mediaItemId" INTEGER NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "fromPosition" REAL NOT NULL DEFAULT 0,
    "toPosition" REAL NOT NULL DEFAULT 0,
    "speed" REAL NOT NULL DEFAULT 1,
    CONSTRAINT "PlaySession_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlaySession_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScanState" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "libraryRootId" INTEGER NOT NULL,
    "lastScanAt" DATETIME,
    "filesFound" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "message" TEXT,
    CONSTRAINT "ScanState_libraryRootId_fkey" FOREIGN KEY ("libraryRootId") REFERENCES "LibraryRoot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "LibraryRoot_path_key" ON "LibraryRoot"("path");

-- CreateIndex
CREATE UNIQUE INDEX "MediaItem_libraryRootId_filePath_key" ON "MediaItem"("libraryRootId", "filePath");

-- CreateIndex
CREATE UNIQUE INDEX "Contributor_name_role_key" ON "Contributor"("name", "role");

-- CreateIndex
CREATE UNIQUE INDEX "MetadataCandidate_mediaItemId_source_providerKey_key" ON "MetadataCandidate"("mediaItemId", "source", "providerKey");

-- CreateIndex
CREATE INDEX "FieldOverride_mediaItemId_idx" ON "FieldOverride"("mediaItemId");

-- CreateIndex
CREATE UNIQUE INDEX "FieldOverride_mediaItemId_field_key" ON "FieldOverride"("mediaItemId", "field");

-- CreateIndex
CREATE UNIQUE INDEX "Genre_slug_key" ON "Genre"("slug");

-- CreateIndex
CREATE INDEX "Genre_parentId_idx" ON "Genre"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "GenreMapping_provider_rawValue_key" ON "GenreMapping"("provider", "rawValue");

-- CreateIndex
CREATE INDEX "MediaItemGenre_genreId_idx" ON "MediaItemGenre"("genreId");

-- CreateIndex
CREATE INDEX "Favourite_profileId_idx" ON "Favourite"("profileId");

-- CreateIndex
CREATE INDEX "Favourite_mediaItemId_idx" ON "Favourite"("mediaItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Favourite_profileId_mediaItemId_key" ON "Favourite"("profileId", "mediaItemId");

-- CreateIndex
CREATE INDEX "ProfileLibraryEntry_profileId_idx" ON "ProfileLibraryEntry"("profileId");

-- CreateIndex
CREATE INDEX "ProfileLibraryEntry_mediaItemId_idx" ON "ProfileLibraryEntry"("mediaItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileLibraryEntry_profileId_mediaItemId_key" ON "ProfileLibraryEntry"("profileId", "mediaItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_key_key" ON "Tag"("key");

-- CreateIndex
CREATE INDEX "Tag_key_idx" ON "Tag"("key");

-- CreateIndex
CREATE INDEX "MediaItemTag_tagId_idx" ON "MediaItemTag"("tagId");

-- CreateIndex
CREATE INDEX "WishlistItem_profileId_idx" ON "WishlistItem"("profileId");

-- CreateIndex
CREATE INDEX "WishlistItem_seedMediaItemId_idx" ON "WishlistItem"("seedMediaItemId");

-- CreateIndex
CREATE UNIQUE INDEX "WishlistItem_profileId_provider_providerKey_key" ON "WishlistItem"("profileId", "provider", "providerKey");

-- CreateIndex
CREATE UNIQUE INDEX "Series_key_key" ON "Series"("key");

-- CreateIndex
CREATE INDEX "EnrichmentItem_runId_idx" ON "EnrichmentItem"("runId");

-- CreateIndex
CREATE INDEX "EnrichmentItem_mediaItemId_idx" ON "EnrichmentItem"("mediaItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ListeningHistory_mediaItemId_profileId_key" ON "ListeningHistory"("mediaItemId", "profileId");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_name_key" ON "Profile"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_profileId_idx" ON "Session"("profileId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceCredential_secretHash_key" ON "DeviceCredential"("secretHash");

-- CreateIndex
CREATE INDEX "DeviceCredential_profileId_idx" ON "DeviceCredential"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "WebAuthnCredential_credentialId_key" ON "WebAuthnCredential"("credentialId");

-- CreateIndex
CREATE INDEX "WebAuthnCredential_profileId_idx" ON "WebAuthnCredential"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "WebAuthnChallenge_challenge_key" ON "WebAuthnChallenge"("challenge");

-- CreateIndex
CREATE INDEX "WebAuthnChallenge_expiresAt_idx" ON "WebAuthnChallenge"("expiresAt");

-- CreateIndex
CREATE INDEX "PlaySession_profileId_mediaItemId_idx" ON "PlaySession"("profileId", "mediaItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ScanState_libraryRootId_key" ON "ScanState"("libraryRootId");

