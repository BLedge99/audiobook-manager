-- Spec 32 / ADR 030: Android native OAuth handoff.
--
-- A sign-in that happens inside a Chrome Custom Tab cannot set the session
-- cookie the browser keeps, so the callback mints this single-use,
-- 60-second, state-bound handle instead and deep-links back to the app. The
-- app redeems it once at POST /api/auth/oauth/handoff; the session is created
-- at redemption time. Code and state are stored as sha256 hashes.
--
-- Additive: new table only, no existing column is touched.

-- CreateTable
CREATE TABLE "OAuthHandoff" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "codeHash" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "profileId" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OAuthHandoff_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "OAuthHandoff_codeHash_key" ON "OAuthHandoff"("codeHash");

-- CreateIndex
CREATE INDEX "OAuthHandoff_expiresAt_idx" ON "OAuthHandoff"("expiresAt");

-- Spec 35 / ADR 026: created after the spec-35 sweep, so RLS is enabled
-- here, the same way every table created after spec 35 must do it.
ALTER TABLE "OAuthHandoff" ENABLE ROW LEVEL SECURITY;
