-- CreateTable
CREATE TABLE "LibraryRoot" (
    "id" SERIAL NOT NULL,
    "path" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LibraryRoot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaItem" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "narrator" TEXT,
    "description" TEXT,
    "coverImagePath" TEXT,
    "coverImageUrl" TEXT,
    "releaseDate" TIMESTAMP(3),
    "genre" TEXT,
    "isbn" TEXT,
    "asin" TEXT,
    "filePath" TEXT NOT NULL,
    "fileFormat" TEXT NOT NULL,
    "duration" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "chapters" TEXT,
    "metadataSource" TEXT,
    "metadataConfidence" DOUBLE PRECISION,
    "enrichmentStatus" TEXT,
    "enrichedAt" TIMESTAMP(3),
    "subtitle" TEXT,
    "seriesId" INTEGER,
    "seriesPosition" DOUBLE PRECISION,
    "publisher" TEXT,
    "publishedYear" INTEGER,
    "language" TEXT,
    "unabridged" BOOLEAN NOT NULL DEFAULT false,
    "libraryRootId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Track" (
    "id" SERIAL NOT NULL,
    "mediaItemId" INTEGER NOT NULL,
    "filePath" TEXT NOT NULL,
    "title" TEXT,
    "duration" DOUBLE PRECISION NOT NULL,
    "trackNumber" INTEGER NOT NULL,
    "sizeBytes" BIGINT,

    CONSTRAINT "Track_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contributor" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contributor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContributorMediaItem" (
    "contributorId" INTEGER NOT NULL,
    "mediaItemId" INTEGER NOT NULL,

    CONSTRAINT "ContributorMediaItem_pkey" PRIMARY KEY ("contributorId","mediaItemId")
);

-- CreateTable
CREATE TABLE "MetadataCandidate" (
    "id" SERIAL NOT NULL,
    "mediaItemId" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "coverUrl" TEXT,
    "description" TEXT,
    "confidence" DOUBLE PRECISION,
    "raw" TEXT,
    "narrators" TEXT,
    "seriesName" TEXT,
    "seriesPosition" DOUBLE PRECISION,
    "publisher" TEXT,
    "publishedYear" INTEGER,
    "language" TEXT,
    "genres" TEXT,
    "providerKey" TEXT,

    CONSTRAINT "MetadataCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldOverride" (
    "id" SERIAL NOT NULL,
    "mediaItemId" INTEGER NOT NULL,
    "field" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FieldOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Genre" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isCatchAll" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Genre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenreMapping" (
    "id" SERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "rawValue" TEXT NOT NULL,
    "genreId" INTEGER NOT NULL,

    CONSTRAINT "GenreMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaItemGenre" (
    "mediaItemId" INTEGER NOT NULL,
    "genreId" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'provider',

    CONSTRAINT "MediaItemGenre_pkey" PRIMARY KEY ("mediaItemId","genreId")
);

-- CreateTable
CREATE TABLE "Favourite" (
    "id" SERIAL NOT NULL,
    "profileId" INTEGER NOT NULL,
    "mediaItemId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Favourite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileLibraryEntry" (
    "id" SERIAL NOT NULL,
    "profileId" INTEGER NOT NULL,
    "mediaItemId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileLibraryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "createdBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaItemTag" (
    "mediaItemId" INTEGER NOT NULL,
    "tagId" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaItemTag_pkey" PRIMARY KEY ("mediaItemId","tagId")
);

-- CreateTable
CREATE TABLE "WishlistItem" (
    "id" SERIAL NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WishlistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Series" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,

    CONSTRAINT "Series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnrichmentRun" (
    "id" SERIAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "queued" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "applied" INTEGER NOT NULL DEFAULT 0,
    "review" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnrichmentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnrichmentItem" (
    "id" SERIAL NOT NULL,
    "runId" INTEGER NOT NULL,
    "mediaItemId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "provider" TEXT,
    "confidence" DOUBLE PRECISION,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnrichmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListeningHistory" (
    "id" SERIAL NOT NULL,
    "mediaItemId" INTEGER NOT NULL,
    "profileId" INTEGER,
    "position" DOUBLE PRECISION NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "lastPlayed" TIMESTAMP(3) NOT NULL,
    "playedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListeningHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Profile" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "passwordHash" TEXT,
    "passwordUpdatedAt" TIMESTAMP(3),
    "role" TEXT NOT NULL DEFAULT 'member',
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "followsServerLibrary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "profileId" INTEGER,
    "via" TEXT NOT NULL,
    "userAgent" TEXT,
    "deviceLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceCredential" (
    "id" TEXT NOT NULL,
    "profileId" INTEGER NOT NULL,
    "secretHash" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "DeviceCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebAuthnCredential" (
    "id" TEXT NOT NULL,
    "profileId" INTEGER NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "transports" TEXT,
    "backedUp" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "WebAuthnCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebAuthnChallenge" (
    "id" TEXT NOT NULL,
    "profileId" INTEGER,
    "challenge" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebAuthnChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaySession" (
    "id" SERIAL NOT NULL,
    "profileId" INTEGER NOT NULL,
    "mediaItemId" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "fromPosition" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "toPosition" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "speed" DOUBLE PRECISION NOT NULL DEFAULT 1,

    CONSTRAINT "PlaySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanState" (
    "id" SERIAL NOT NULL,
    "libraryRootId" INTEGER NOT NULL,
    "lastScanAt" TIMESTAMP(3),
    "filesFound" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "message" TEXT,

    CONSTRAINT "ScanState_pkey" PRIMARY KEY ("id")
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

-- AddForeignKey
ALTER TABLE "MediaItem" ADD CONSTRAINT "MediaItem_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaItem" ADD CONSTRAINT "MediaItem_libraryRootId_fkey" FOREIGN KEY ("libraryRootId") REFERENCES "LibraryRoot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Track" ADD CONSTRAINT "Track_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributorMediaItem" ADD CONSTRAINT "ContributorMediaItem_contributorId_fkey" FOREIGN KEY ("contributorId") REFERENCES "Contributor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributorMediaItem" ADD CONSTRAINT "ContributorMediaItem_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetadataCandidate" ADD CONSTRAINT "MetadataCandidate_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldOverride" ADD CONSTRAINT "FieldOverride_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Genre" ADD CONSTRAINT "Genre_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Genre"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenreMapping" ADD CONSTRAINT "GenreMapping_genreId_fkey" FOREIGN KEY ("genreId") REFERENCES "Genre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaItemGenre" ADD CONSTRAINT "MediaItemGenre_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaItemGenre" ADD CONSTRAINT "MediaItemGenre_genreId_fkey" FOREIGN KEY ("genreId") REFERENCES "Genre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favourite" ADD CONSTRAINT "Favourite_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favourite" ADD CONSTRAINT "Favourite_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileLibraryEntry" ADD CONSTRAINT "ProfileLibraryEntry_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileLibraryEntry" ADD CONSTRAINT "ProfileLibraryEntry_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaItemTag" ADD CONSTRAINT "MediaItemTag_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaItemTag" ADD CONSTRAINT "MediaItemTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WishlistItem" ADD CONSTRAINT "WishlistItem_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WishlistItem" ADD CONSTRAINT "WishlistItem_seedMediaItemId_fkey" FOREIGN KEY ("seedMediaItemId") REFERENCES "MediaItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrichmentItem" ADD CONSTRAINT "EnrichmentItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "EnrichmentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrichmentItem" ADD CONSTRAINT "EnrichmentItem_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListeningHistory" ADD CONSTRAINT "ListeningHistory_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListeningHistory" ADD CONSTRAINT "ListeningHistory_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceCredential" ADD CONSTRAINT "DeviceCredential_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebAuthnCredential" ADD CONSTRAINT "WebAuthnCredential_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebAuthnChallenge" ADD CONSTRAINT "WebAuthnChallenge_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaySession" ADD CONSTRAINT "PlaySession_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaySession" ADD CONSTRAINT "PlaySession_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanState" ADD CONSTRAINT "ScanState_libraryRootId_fkey" FOREIGN KEY ("libraryRootId") REFERENCES "LibraryRoot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

