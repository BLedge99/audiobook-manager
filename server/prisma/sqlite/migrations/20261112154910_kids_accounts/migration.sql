-- AlterTable
ALTER TABLE "MediaItem" ADD COLUMN "minimumAge" INTEGER;
ALTER TABLE "MediaItem" ADD COLUMN "suggestedMinimumAge" INTEGER;
ALTER TABLE "MediaItem" ADD COLUMN "suggestedMinimumAgeSource" TEXT;

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN "ageBand" TEXT;

-- CreateTable
CREATE TABLE "BlocklistGenre" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "genreId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BlocklistGenre_genreId_fkey" FOREIGN KEY ("genreId") REFERENCES "Genre" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "BlocklistGenre_genreId_key" ON "BlocklistGenre"("genreId");

-- CreateIndex
CREATE INDEX "BlocklistGenre_genreId_idx" ON "BlocklistGenre"("genreId");
