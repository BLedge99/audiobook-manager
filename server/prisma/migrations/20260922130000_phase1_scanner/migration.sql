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
    "libraryRootId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
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
    CONSTRAINT "Track_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
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
    CONSTRAINT "ContributorMediaItem_contributorId_fkey" FOREIGN KEY ("contributorId") REFERENCES "Contributor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ContributorMediaItem_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    PRIMARY KEY ("contributorId", "mediaItemId")
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
    CONSTRAINT "MetadataCandidate_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ListeningHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "mediaItemId" INTEGER NOT NULL,
    "position" REAL NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "lastPlayed" DATETIME NOT NULL,
    "playedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ListeningHistory_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
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
CREATE UNIQUE INDEX "MediaItem_libraryRootId_filePath_key" ON "MediaItem"("libraryRootId", "filePath");
CREATE UNIQUE INDEX "ScanState_libraryRootId_key" ON "ScanState"("libraryRootId");
