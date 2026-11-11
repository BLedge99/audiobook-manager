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
ALTER TABLE "Session" ADD COLUMN "deviceCredentialId" TEXT;

-- AlterTable
ALTER TABLE "DeviceCredential" ADD COLUMN "deviceId" TEXT;

-- CreateIndex
CREATE INDEX "Session_deviceCredentialId_idx" ON "Session"("deviceCredentialId");

-- CreateIndex
CREATE INDEX "DeviceCredential_deviceId_idx" ON "DeviceCredential"("deviceId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_deviceCredentialId_fkey" FOREIGN KEY ("deviceCredentialId") REFERENCES "DeviceCredential"("id") ON DELETE SET NULL ON UPDATE CASCADE;
