/**
 * Spec 38: the password-reset core shared by the family-app admin route
 * (spec 28) and the admin-panel kids-accounts page (ADR 033).
 *
 * The steps must not drift apart: validate the new password against the
 * profile's own name, hash it, clear any lockout, revoke every session and
 * device credential. Passkeys survive deliberately — the profile can sign
 * back in with Windows Hello / a device Vault after a reset.
 */
import type { PrismaClient } from "@prisma/client";
import { hashPassword, validatePassword } from "./password";
import { AuthFailure } from "./service";

export async function resetProfilePasswordCore(
  prisma: PrismaClient,
  targetId: number,
  newPassword: string,
  now: Date = new Date(),
) {
  const target = await prisma.profile.findUnique({ where: { id: targetId } });
  if (!target) throw new AuthFailure(404, "not_found");
  const failure = validatePassword(newPassword, target.name);
  if (failure) throw new AuthFailure(400, failure.code, failure.params);

  const passwordHash = await hashPassword(newPassword);
  const updated = await prisma.profile.update({
    where: { id: target.id },
    data: {
      passwordHash,
      passwordUpdatedAt: now,
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });

  await prisma.session.updateMany({
    where: { profileId: target.id, revokedAt: null },
    data: { revokedAt: now },
  });
  await prisma.deviceCredential.updateMany({
    where: { profileId: target.id, revokedAt: null },
    data: { revokedAt: now },
  });
  return updated;
}
