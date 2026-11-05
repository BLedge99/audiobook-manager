-- Track the last successful authentication per profile so the 24-month
-- inactivity retention rule can identify inactive accounts (Phase 6, GDPR Art. 5(1)(e)).
ALTER TABLE "Profile" ADD COLUMN "lastActiveAt" DATETIME;
