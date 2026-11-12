-- Spec 38 / ADR 033: kids accounts.
--
-- A child is a Profile whose role is the new value "child". `Profile.ageBand`
-- holds one of under-6 (maxAge 5) | 6-9 (9) | 10-13 (13) | 14-17 (17); no
-- date of birth is stored. `MediaItem.minimumAge` is the confirmed,
-- admin-set rating (null = unrated = visible); the `suggested*` pair carries
-- provider-derived guesses and never gates. `BlocklistGenre` is the
-- household's admin-managed genre blocklist: a book whose genre is listed
-- is hidden from every child account, whatever its rating.
--
-- Additive: no column is removed or repurposed, and no row is rewritten.

-- AlterTable
ALTER TABLE "MediaItem" ADD COLUMN "minimumAge" INTEGER;
ALTER TABLE "MediaItem" ADD COLUMN "suggestedMinimumAge" INTEGER;
ALTER TABLE "MediaItem" ADD COLUMN "suggestedMinimumAgeSource" TEXT;

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN "ageBand" TEXT;

-- CreateTable
CREATE TABLE "BlocklistGenre" (
    "id" SERIAL NOT NULL,
    "genreId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlocklistGenre_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BlocklistGenre_genreId_key" ON "BlocklistGenre"("genreId");

-- CreateIndex
CREATE INDEX "BlocklistGenre_genreId_idx" ON "BlocklistGenre"("genreId");

-- AddForeignKey
ALTER TABLE "BlocklistGenre" ADD CONSTRAINT "BlocklistGenre_genreId_fkey" FOREIGN KEY ("genreId") REFERENCES "Genre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-Level Security (spec 35 / ADR 026): every table added after the
-- RLS migration protects itself in the same migration, via a plain
-- statement -- this is the form `postgres-rls.test.ts` accepts for
-- later-added tables.
ALTER TABLE "BlocklistGenre" ENABLE ROW LEVEL SECURITY;
