-- Spec 19 / ADR 010: persisted Open Library subject search pools.
--
-- Discover searches Open Library live at request time. The in-memory cache
-- survives a warm server but not a deploy/restart, so on cold starts Discover
-- relied on the external provider answering within the request budget and
-- fell through to "no new books found yet" whenever it didn't. This table is
-- the durable pool: candidates are served from it when fresh, and kept as a
-- stale fallback when the provider is down.
CREATE TABLE "SubjectPool" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" TEXT NOT NULL
);
