-- One resume point per (mediaItem, profile).
-- Concurrent progress saves previously raced between "find existing" and
-- "create", leaving duplicate rows that made resume non-deterministic and
-- would make the unique index below fail to apply on an affected database.
--
-- Keep the most recently played row per pair (that is the one the client
-- would have resumed from) and drop the rest.
DELETE FROM "ListeningHistory"
WHERE "id" NOT IN (
  SELECT "id" FROM (
    SELECT "id",
           ROW_NUMBER() OVER (
             PARTITION BY "mediaItemId", "profileId"
             ORDER BY "lastPlayed" DESC, "playedAt" DESC, "id" DESC
           ) AS rn
    FROM "ListeningHistory"
  ) ranked
  WHERE ranked.rn = 1
);

CREATE UNIQUE INDEX "ListeningHistory_mediaItemId_profileId_key" ON "ListeningHistory"("mediaItemId", "profileId");
