-- Spec 36: a session belongs to a device, not to a sign-in.
--
-- `Session.deviceCredentialId` links a session to the device credential it was
-- minted from. The link is server-generated and unforgeable, so it -- not the
-- client-supplied device id -- is what decides which session is reused.
--
-- `DeviceCredential.deviceId` is an opaque installation identifier the client
-- generates once. It names a device in the "Signed-in devices" panel and
-- authorises nothing.
--
-- Additive: no column is removed or repurposed, and no row is rewritten.

-- AlterTable
ALTER TABLE "DeviceCredential" ADD COLUMN "deviceId" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Session" (
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
    "deviceCredentialId" TEXT,
    CONSTRAINT "Session_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Session_deviceCredentialId_fkey" FOREIGN KEY ("deviceCredentialId") REFERENCES "DeviceCredential" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Session" ("createdAt", "deviceLabel", "expiresAt", "id", "lastUsedAt", "profileId", "revokedAt", "tokenHash", "userAgent", "via") SELECT "createdAt", "deviceLabel", "expiresAt", "id", "lastUsedAt", "profileId", "revokedAt", "tokenHash", "userAgent", "via" FROM "Session";
DROP TABLE "Session";
ALTER TABLE "new_Session" RENAME TO "Session";
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX "Session_profileId_idx" ON "Session"("profileId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE INDEX "Session_deviceCredentialId_idx" ON "Session"("deviceCredentialId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "DeviceCredential_deviceId_idx" ON "DeviceCredential"("deviceId");
