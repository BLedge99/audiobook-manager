-- Spec 43 phase 7.3: cover-retry counter for the enrichment selection queue.
ALTER TABLE "MediaItem" ADD COLUMN "coverRetryCount" INTEGER NOT NULL DEFAULT 0;
