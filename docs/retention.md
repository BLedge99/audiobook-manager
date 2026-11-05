# Retention & Storage Limitation Schedule — GDPR Art. 5(1)(e)

**Last updated:** 5 November 2026  
**Status:** Draft — implements Phase 6 of `docs/GDPR-REMEDIATION-PLAN.md`  
**Automated cleanup:** `AuthService.cleanupExpired()` in `server/src/auth/service.ts`, run at server startup and after every login (best effort; `validate` already rejects expired rows).

This schedule maps each personal-data table in `server/prisma/schema.prisma` to a retention period and the mechanism that enforces it. No personal data is kept beyond its retention period without a legal basis.

---

## Retention schedule by table

| # | Table | Personal data | Retention period | Enforcement |
|---|-------|--------------|-----------------|-------------|
| 1 | `Profile` | name, color, email, oauth provider/id, password hash, role, login history | While account active; **24 months of inactivity** → profile and all related rows deleted | `cleanupExpired()` deletes profiles with no `lastActiveAt` for 24 months; self-service `DELETE /api/me` deletes on demand; admin `DELETE /api/profiles/:id` break-glass |
| 2 | `Session` | token hash, profile id, user agent, device label, created/last-used/expires | TTL-based: 30-day sliding TTL, 90-day hard max age from creation; revoked sessions deleted on cleanup | `cleanupExpired()` deletes rows where `expiresAt < now` or `revokedAt IS NOT NULL` |
| 3 | `ListeningHistory` | media item id, position, played/last-played (profile-scoped) | Until removed by user (`DELETE /api/me/listening-history/:id`) or account erasure | Self-service endpoint; cascades on profile deletion |
| 4 | `PlaySession` | media item id, positions, started/ended (profile-scoped) | Until removed by user or account erasure | Cascades on profile deletion |
| 5 | `Favourite` | media item id (profile-scoped) | Until removed by user (`DELETE /api/me/favourites/:mediaItemId`) or account erasure | Self-service endpoint; cascades on profile deletion |
| 6 | `WishlistItem` | title, author, provider key, etc. (profile-scoped) | Until removed by user or account erasure | Cascades on profile deletion |
| 7 | `ProfileLibraryEntry` | media item id (profile-scoped) | Until entry removed or account erasure | Cascades on profile deletion |
| 8 | `DeviceCredential` | secret hash, label, expires at (profile-scoped) | 90 days from creation; revoked credentials deleted on cleanup | `createDeviceCredential` sets `expiresAt = now + 90 days`; `cleanupExpired()` deletes expired rows |
| 9 | `WebAuthnCredential` | credential id, public key, counter (profile-scoped) | Until removed by user or account erasure; no expiry on the credential itself | Cascades on profile deletion |
| 10 | `WebAuthnChallenge` | challenge, type, expires at (profile-scoped, nullable) | 5 minutes; single-use, deleted after consumption | `cleanupExpired()` deletes rows where `expiresAt < now` |
| 11 | `AdminSession` | token hash, expires at, revoked at | TTL-based (same as `Session`); revoked sessions deleted on cleanup | `cleanupExpired()` deletes expired admin sessions |
| 12 | `AdminCredential` | password hash | Until rotated; no automatic expiry | Admin rotation only |

---

## Inactive profile rule

A profile is **inactive** when it has not had any successful authentication for 24 consecutive months. "Authentication" includes password sign-in, OAuth sign-in, device-credential exchange, and WebAuthn assertion — each updates `Profile.lastActiveAt`.

When a profile is flagged inactive:

1. The profile row itself is deleted.
2. All related personal-data rows cascade-delete (Session, ListeningHistory, PlaySession, Favourite, WishlistItem, ProfileLibraryEntry, DeviceCredential, WebAuthnCredential, WebAuthnChallenge) via `onDelete: Cascade` relations.
3. The household library and MediaItem catalogue are unaffected — they contain no personal data about the profile.

Profiles with no `lastActiveAt` at all (created but never used) are evaluated against `createdAt`; if the account was created more than 24 months ago and never signed into, it is also inactive.

---

## Client-side data

| Store | Data | Retention | Enforcement |
|-------|------|-----------|-------------|
| IndexedDB `privateRows` | Encrypted per-profile progress/favourites/wishlist | Until profile deletion or explicit clear | `DELETE /api/me` response triggers client to wipe `privateRows`/`keyEnvelopes` and `localStorage.profileId` |
| IndexedDB `books` / `covers` | Book replica + cover images | Until source removed or cache expiry | Scanner/cache eviction, not personal data |
| `localStorage` | Active profile id, server URL, explicit offline-mode boolean | Profile id until sign-out/profile deletion; server URL and mode preference until changed | `lockSession()` clears token; `DELETE /api/me` clears profile id; reconnect clears offline preference |
| Session token | Browser memory / HttpOnly cookie (web) | Session TTL | Cookie expires with session; Android holds in memory |
| Registration form values | Name and household/profile passwords | Request lifetime only | Component state is discarded after submission; household password is never persisted; only the server-side profile password hash is retained |

---

## Cross-reference

- RoPA: `docs/roa.md` — maps each activity to lawful basis and retention.
- Governance: `docs/gdpr-governance.md` — data-protection lead owns the schedule and reviews it annually.
- Audit: `GDPR-AUDIT.md` §5 (storage limitation findings).
- Code: `server/src/auth/service.ts` `cleanupExpired()`; `server/src/auth/routes.ts` `cleanupAfterLogin()`; `server/src/index.ts` startup cleanup.
