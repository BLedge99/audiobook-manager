# Retention & Storage Limitation Schedule — GDPR Art. 5(1)(e)

**Last updated:** 12 November 2026  
**Status:** Draft — implements Phase 6 of `docs/GDPR-REMEDIATION-PLAN.md`  
**Automated cleanup:** `server/src/gdpr/personal-data.ts` is the enforcement point for the personal-data table list and the 24-month inactive-profile retention rule. `AuthService.cleanupExpired()` in `server/src/auth/service.ts` runs at server startup and after every login (best effort) and delegates the personal-data cleanup/purge to that module; `validate` already rejects expired rows.

This schedule maps each personal-data table in `server/prisma/schema.prisma` to a retention period and the mechanism that enforces it. No personal data is kept beyond its retention period without a legal basis.

---

## Retention schedule by table

| # | Table | Personal data | Retention period | Enforcement |
|---|-------|--------------|-----------------|-------------|
| 1 | `Profile` | name, color, email, oauth provider/id, password hash, role, login history | While account active; **24 months of inactivity** → profile and all related rows deleted | `cleanupExpired()` deletes profiles with no `lastActiveAt` for 24 months; self-service `DELETE /api/me` deletes on demand; admin `DELETE /api/profiles/:id` break-glass |
| 2 | `Session` | token hash, profile id, user agent, device label, device credential id, created/last-used/expires | TTL-based: 30-day sliding TTL, 90-day hard max age from creation; revoked sessions deleted on cleanup | `cleanupExpired()` deletes rows where `expiresAt < now` or `revokedAt IS NOT NULL`. A session reused by the same device keeps its original creation date, so the 90-day cap is measured from the first sign-in on that device |
| 3 | `ListeningHistory` | media item id, position, played/last-played (profile-scoped) | Until removed by user (`DELETE /api/me/listening-history/:id`) or account erasure | Self-service endpoint; cascades on profile deletion |
| 4 | `PlaySession` | media item id, positions, started/ended (profile-scoped) | Until removed by user or account erasure | Cascades on profile deletion |
| 5 | `Favourite` | media item id (profile-scoped) | Until removed by user (`DELETE /api/me/favourites/:mediaItemId`) or account erasure | Self-service endpoint; cascades on profile deletion |
| 6 | `WishlistItem` | title, author, provider key, etc. (profile-scoped) | Until removed by user or account erasure | Cascades on profile deletion |
| 7 | `ProfileLibraryEntry` | media item id (profile-scoped) | Until entry removed or account erasure | Cascades on profile deletion |
| 8 | `DeviceCredential` | secret hash, label, device id, expires at (profile-scoped) | 90 days from creation; revoked credentials deleted on cleanup | `createDeviceCredential` sets `expiresAt = now + 90 days`; `cleanupExpired()` deletes expired rows. The device id is an opaque installation identifier used for display only, and is deleted with the credential |
| 9 | `WebAuthnCredential` | credential id, public key, counter (profile-scoped) | Until removed by user or account erasure; no expiry on the credential itself | Cascades on profile deletion |
| 10 | `WebAuthnChallenge` | challenge, type, expires at (profile-scoped, nullable) | 5 minutes; single-use, deleted after consumption | `cleanupExpired()` deletes rows where `expiresAt < now` |
| 11 | `AdminSession` | token hash, expires at, revoked at | TTL-based (same as `Session`); revoked sessions deleted on cleanup | `cleanupExpired()` deletes expired admin sessions |
| 12 | `AdminCredential` | password hash | Until rotated; no automatic expiry | Admin rotation only |
| 13 | `OAuthHandoff` | sha256 code + state, pseudonymous profile id, expiry (native OAuth handoff, ADR 036) | Single-use + 60 s TTL; consumed at exchange, otherwise swept | Exchange consumes atomically; expired rows deleted at startup sweep |
| 14 | `Profile.ageBand` (column on `Profile`, kids accounts, spec 38) | the child's age band (`under-6`…`14-17`); never a date of birth | Deleted with the profile row (erasure or 24-month inactivity purge) | Same enforcement as `Profile` (#1); erased cascade covers it; included in the GDPR export |
| 15 | `MediaItem.minimumAge` / `suggestedMinimumAge` / `suggestedMinimumAgeSource` | catalogue data (not personal data) | Deleted with the book; suggestions cleared on admin confirm/dismiss | `MediaItem` lifecycle; admin actions clear suggestions |
| 16 | `BlocklistGenre` (household genre blocklist, spec 38) | household configuration (not personal data) | Until the admin removes the genre from the blocklist | `DELETE /api/admin/genre-blocklist/:genreId`; cascades on `Genre` deletion |
| 17 | `GenreBlocklistSeed` (one-row seed marker, spec 38) | household configuration (not personal data) | Forever; it records that the default blocklist was seeded once | Never re-created once written; deleted with a full DB reset |

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
| IndexedDB `books` / `covers` | Book replica + cover images (carries `minimumAge` for the offline kids-account ladder, spec 38) | Until source removed or cache expiry | Scanner/cache eviction, not personal data |
| `localStorage` | Active profile id, server URL, recent servers list, explicit offline-mode boolean | Profile id until sign-out/profile deletion; server URL and mode preference until changed; recent-servers entries until forgotten or overwritten (max 5) | `lockSession()` clears token; `DELETE /api/me` clears profile id; reconnect clears offline preference; forgetting an entry removes it (spec 40) |
| Session token | Browser memory / HttpOnly cookie (web) | Session TTL | Cookie expires with session; Android holds in memory |
| Registration form values | Name and household/profile passwords | Request lifetime only | Component state is discarded after submission; household password is never persisted; only the server-side profile password hash is retained |

---

## Cross-reference

- RoPA: `docs/roa.md` — maps each activity to lawful basis and retention.
- Governance: `docs/gdpr-governance.md` — data-protection lead owns the schedule and reviews it annually.
- Audit: `GDPR-AUDIT.md` §5 (storage limitation findings).
- Code: `server/src/auth/service.ts` `cleanupExpired()`; `server/src/auth/routes.ts` `cleanupAfterLogin()`; `server/src/index.ts` startup cleanup.
