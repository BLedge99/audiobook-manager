-- Spec 28 / ADR 016: profiles become accounts.
--
-- Additive only. No profile, book or history row is deleted. The two test
-- profiles are renamed when the target name is free; otherwise both rows are
-- left alone. `admin` is inserted if it is missing and, only when it has no
-- library entries, given every book already on the server.

-- Profile auth fields -------------------------------------------------------
ALTER TABLE "Profile" ADD COLUMN "passwordHash" TEXT;
ALTER TABLE "Profile" ADD COLUMN "passwordUpdatedAt" DATETIME;
ALTER TABLE "Profile" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'member';
ALTER TABLE "Profile" ADD COLUMN "disabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Profile" ADD COLUMN "failedLoginCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Profile" ADD COLUMN "lockedUntil" DATETIME;
ALTER TABLE "Profile" ADD COLUMN "lastLoginAt" DATETIME;

-- Sessions ------------------------------------------------------------------
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "profileId" INTEGER,
    "via" TEXT NOT NULL,
    "userAgent" TEXT,
    "deviceLabel" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    CONSTRAINT "Session_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX "Session_profileId_idx" ON "Session"("profileId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- Android device credentials -------------------------------------------------
CREATE TABLE "DeviceCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" INTEGER NOT NULL,
    "secretHash" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    CONSTRAINT "DeviceCredential_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DeviceCredential_secretHash_key" ON "DeviceCredential"("secretHash");
CREATE INDEX "DeviceCredential_profileId_idx" ON "DeviceCredential"("profileId");

-- WebAuthn / Windows Hello ---------------------------------------------------
CREATE TABLE "WebAuthnCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" INTEGER NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "transports" TEXT,
    "backedUp" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME,
    CONSTRAINT "WebAuthnCredential_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WebAuthnCredential_credentialId_key" ON "WebAuthnCredential"("credentialId");
CREATE INDEX "WebAuthnCredential_profileId_idx" ON "WebAuthnCredential"("profileId");

CREATE TABLE "WebAuthnChallenge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" INTEGER,
    "challenge" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "WebAuthnChallenge_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WebAuthnChallenge_challenge_key" ON "WebAuthnChallenge"("challenge");
CREATE INDEX "WebAuthnChallenge_expiresAt_idx" ON "WebAuthnChallenge"("expiresAt");

-- Data migration ------------------------------------------------------------
-- The old test profiles become the new named test accounts. Each rename is
-- skipped rather than allowed to collide with an existing row.
UPDATE "Profile" SET "role" = 'admin' WHERE "name" IN ('admin', 'admin-test', 'Testing');
UPDATE "Profile" SET "name" = 'test' WHERE "name" = 'Playwright'
    AND NOT EXISTS (SELECT 1 FROM "Profile" WHERE "name" = 'test');
UPDATE "Profile" SET "name" = 'admin-test' WHERE "name" = 'Testing'
    AND NOT EXISTS (SELECT 1 FROM "Profile" WHERE "name" = 'admin-test');
UPDATE "Profile" SET "role" = 'admin' WHERE "name" = 'admin-test';

-- The household admin account. An existing install gets one if it has never
-- had one. A brand-new database is left empty here on purpose: the server
-- entrypoint seeds the full default set when the profile table is empty, and
-- inserting `admin` would make that check false and skip the rest.
INSERT INTO "Profile" ("name", "role", "followsServerLibrary", "createdAt")
SELECT 'admin', 'admin', 1, CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "Profile")
  AND NOT EXISTS (SELECT 1 FROM "Profile" WHERE "name" = 'admin');

-- A brand-new admin follows the server library, so it must start with the
-- books already there. Only fill it when it has no entries at all, so an admin
-- who deliberately emptied their shelf is not re-filled by a later deploy.
INSERT OR IGNORE INTO "ProfileLibraryEntry" ("profileId", "mediaItemId", "createdAt")
SELECT (SELECT "id" FROM "Profile" WHERE "name" = 'admin'), "id", CURRENT_TIMESTAMP
FROM "MediaItem"
WHERE EXISTS (SELECT 1 FROM "Profile" WHERE "name" = 'admin')
  AND NOT EXISTS (
      SELECT 1 FROM "ProfileLibraryEntry"
      WHERE "profileId" = (SELECT "id" FROM "Profile" WHERE "name" = 'admin')
  );
