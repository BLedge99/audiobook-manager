# Spec: GDPR Retention & Storage Limitation

**Status:** Draft — implements GDPR remediation Phase 6  
**GDPR basis:** Art. 5(1)(e) — personal data kept no longer than necessary

---

## 1. Purpose

Define how long each category of personal data is kept and how expiry is enforced automatically. No personal data is retained beyond its retention period without a legal basis.

---

## 2. Retention schedule by table

| Table | Data | Retention | Enforcement |
|-------|------|-----------|-------------|
| `Profile` | name, color, email, oauth provider/id, password hash, role | Active account; **24 months of inactivity** → deleted with cascade | `cleanupExpired()` checks `lastActiveAt` (or `createdAt` if never used); self-service `DELETE /api/me`; admin `DELETE /api/profiles/:id` |
| `Session` | token hash, profile id, user agent, device label, timestamps | 30-day sliding TTL, 90-day hard max age; revoked sessions deleted | `cleanupExpired()` deletes `expiresAt < now` or `revokedAt IS NOT NULL` |
| `ListeningHistory` | media item id, position, played/last-played | Until user removes it or account is erased | `DELETE /api/me/listening-history/:id`; cascades on profile deletion |
| `PlaySession` | media item id, positions, started/ended | Until user removes it or account is erased | Cascades on profile deletion |
| `Favourite` | media item id | Until user removes it or account is erased | `DELETE /api/me/favourites/:mediaItemId`; cascades on profile deletion |
| `WishlistItem` | title, author, provider key, etc. | Until user removes it or account is erased | Cascades on profile deletion |
| `ProfileLibraryEntry` | media item id | Until entry removed or account is erased | Cascades on profile deletion |
| `DeviceCredential` | secret hash, label, expires at | 90 days from creation; revoked deleted | `cleanupExpired()` deletes expired/revoked |
| `WebAuthnCredential` | credential id, public key, counter | Until removed by user or account erasure | Cascades on profile deletion |
| `WebAuthnChallenge` | challenge, type, expires at | 5 minutes; single-use | `cleanupExpired()` deletes expired; consumed rows deleted after use |
| `AdminSession` | token hash, expires at, revoked at | Same TTL rules as `Session` | `cleanupExpired()` deletes expired/revoked |
| `AdminCredential` | password hash | Until rotated | Admin rotation only |
| `OAuthHandoff` | sha256 code/state, pseudonymous profile id, expiry | Single-use + 60 s TTL | Consumed at exchange; expired rows swept at startup |
| `Profile.ageBand` | the child's age band (kids accounts, spec 38) | Deleted with the profile row | Same enforcement as `Profile` (inactivity purge/erasure); included in GDPR export |
| `MediaItem.minimumAge` / `suggestedMinimumAge` / `suggestedMinimumAgeSource` | catalogue data (not personal data) | Deleted with the book | Cleared suggestions on admin confirm/dismiss |
| `BlocklistGenre` | household genre blocklist (not personal data) | Until admin removes it | Admin panel management; cascades with genre deletion |
| `GenreBlocklistSeed` | one-row seed marker (not personal data) | Forever | Written once by the default blocklist seed; deleted with a DB reset |

---

## 3. Inactive profile rule

A profile is inactive when no successful authentication has occurred for 24 consecutive months. Every successful authentication (password, OAuth, device credential, WebAuthn) updates `Profile.lastActiveAt`.

Profiles with no `lastActiveAt` (never used) are evaluated against `createdAt`; if created more than 24 months ago and never signed into, they are inactive.

When a profile is deleted for inactivity, all related personal-data rows cascade-delete via `onDelete: Cascade` relations. Media items and the library catalogue are unaffected.

---

## 4. Cleanup mechanism

`AuthService.cleanupExpired()` in `server/src/auth/service.ts`:

- Runs at server startup (`server/src/index.ts`)
- Runs after every login (`server/src/auth/routes.ts` `cleanupAfterLogin`)
- Best effort: failures are swallowed; `validate()` already rejects expired/revoked rows, so correctness never depends on cleanup having run

---

## 5. Client-side data

| Store | Data | Retention | Enforcement |
|-------|------|-----------|-------------|
| IndexedDB `privateRows` / `keyEnvelopes` | Encrypted per-profile progress/favourites/wishlist | Until profile deletion or explicit clear | Wiped on `DELETE /api/me` response |
| `localStorage.profileId` | Active profile identifier | Until sign-out or deletion | Cleared on `DELETE /api/me` |
| Session token | Browser memory / HttpOnly cookie | Session TTL | Cookie expires with session |

---

## 6. Acceptance criteria

- [ ] `docs/retention.md` published and mapped to each personal-data table
- [ ] Expired sessions are removed by `cleanupExpired()` (tested)
- [ ] Expired device credentials are removed by `cleanupExpired()` (tested)
- [ ] Expired admin sessions are removed by `cleanupExpired()` (tested)
- [ ] Expired WebAuthn challenges are removed by `cleanupExpired()` (tested)
- [ ] Inactive profiles (24 months no activity) are deleted with cascade (tested)
- [ ] Never-used profiles (created >24 months ago, never signed in) are deleted (tested)
- [ ] Active profiles are not deleted (tested)
- [ ] Sessions exactly at the expiry boundary are not deleted (tested)

---

## 7. Tests

`server/src/auth/cleanup.test.ts` — 8 tests covering session, webauthn challenge, device credential, admin session, inactive profile, never-used profile, active profile retention, and expiry boundary.

All tests must pass with `make test-server`.
