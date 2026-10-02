-- CreateTable
CREATE TABLE "Profile" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ListeningHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "mediaItemId" INTEGER NOT NULL,
    "profileId" INTEGER,
    "position" REAL NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "lastPlayed" DATETIME NOT NULL,
    "playedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ListeningHistory_mediaItemId_fkey" FOREIGN KEY ("mediaItemId") REFERENCES "MediaItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ListeningHistory_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ListeningHistory" ("completed", "id", "lastPlayed", "mediaItemId", "playedAt", "position") SELECT "completed", "id", "lastPlayed", "mediaItemId", "playedAt", "position" FROM "ListeningHistory";
DROP TABLE "ListeningHistory";
ALTER TABLE "new_ListeningHistory" RENAME TO "ListeningHistory";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

