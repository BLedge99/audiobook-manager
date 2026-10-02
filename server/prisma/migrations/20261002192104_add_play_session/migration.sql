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

-- CreateIndex
CREATE INDEX "PlaySession_profileId_mediaItemId_idx" ON "PlaySession"("profileId", "mediaItemId");

