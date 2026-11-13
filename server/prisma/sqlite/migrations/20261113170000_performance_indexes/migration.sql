-- Performance indexes (2026-11-13). Reverse and lookup indexes that every
-- hot path was missing: book -> tracks/contributors joins, the review queue,
-- child age-band filtering, series pages and resume lookups.
CREATE INDEX "Track_mediaItemId_idx" ON "Track"("mediaItemId");
CREATE INDEX "ContributorMediaItem_mediaItemId_idx" ON "ContributorMediaItem"("mediaItemId");
CREATE INDEX "ListeningHistory_profileId_idx" ON "ListeningHistory"("profileId");
CREATE INDEX "MediaItem_seriesId_idx" ON "MediaItem"("seriesId");
CREATE INDEX "MediaItem_enrichmentStatus_idx" ON "MediaItem"("enrichmentStatus");
CREATE INDEX "MediaItem_minimumAge_idx" ON "MediaItem"("minimumAge");
CREATE INDEX "PlaySession_mediaItemId_idx" ON "PlaySession"("mediaItemId");
