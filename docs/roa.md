# Record of Processing Activities (RoPA) — GDPR Art. 30

**Controller:** audiobook-manager (household / production demo)  
**Contact:** See `docs/gdpr-governance.md`  
**Last updated:** 2026-11-12  
**Status:** Draft — aligns with `server/prisma/schema.prisma` and `server/prisma/sqlite/schema.prisma`

This RoPA maps every processing activity that involves personal data, its purpose, the personal-data categories, the lawful basis, retention, and recipients. It is the authoritative record referenced by `docs/gdpr-governance.md` and the GDPR audit (`GDPR-AUDIT.md`).

**Where the data is held.** In production the database is a managed Supabase
PostgreSQL instance. Row-Level Security is enabled on every table in the
`public` schema and the platform's `anon`/`authenticated` roles hold no grants
on it, so the public Supabase API cannot read or write any of the personal
data listed below. The server is the only reader, and it connects as the role
that owns the tables. This is a technical measure under Art. 32; it changes no
lawful basis, no retention period and no data-subject right. See
[`docs/production-database-access-control.md`](production-database-access-control.md),
spec 35 and ADR 026.

**One definition of personal data.** The profile-owned personal-data table list,
the 24-month inactive-profile retention rule, and the export/erasure/retention
operations are defined in one module, `server/src/gdpr/personal-data.ts`; the
API export and erasure routes and the retention purge read it, so they cannot
drift apart (spec 37, Phase 6). The schema-guard test keeps that list aligned
with `profileId`-bearing models in the schema.

---

## 1. Profile & account management

| Field | Value |
|-------|-------|
| **Activity** | Household-password-authorized profile registration, update, sign-in identity, and deletion |
| **Purpose** | Identity for household members / production-demo users; isolates progress, history, favourites, wishlist, library per person |
| **Personal data** | `Profile.id`, `Profile.name` (display name), `Profile.color`, `Profile.avatar`, `Profile.createdAt`, `Profile.role` (admin/member/child), `Profile.ageBand` (kids accounts, spec 38), hashed profile password (spec 28), OAuth provider ID + email (spec 32, production demo only). The household password is checked transiently and is not retained by this registration flow. |
| **Lawful basis** | Art. 6(1)(b) contract — necessary to provide the service; Art. 6(1)(a) consent for OAuth/email sign-up in production demo |
| **Retention** | Indefinite while account active; deleted on self-service erasure (Phase 4) or admin deletion; inactive-profile purge per retention schedule (Phase 6) |
| **Recipients** | Server only; client receives profile id/name/color for the authenticated profile |
| **Cross-border transfer** | None |
| **Automated decision-making** | None |
| **System** | `server/prisma/schema.prisma` model `Profile`; `server/src/auth/routes.ts` route `/api/auth/register-profile`; `server/src/app.ts` routes `/api/profiles` |

---

## 2. Authentication & sessions

| Field | Value |
|-------|-------|
| **Activity** | Password-based sign-in, passkey/WebAuthn sign-in, OAuth sign-in, session issuance and validation |
| **Personal data** | `Session.tokenHash`, `Session.profileId`, `Session.expiresAt`, `Session.userAgent`, `Session.deviceLabel`, `Session.deviceCredentialId`, `Session.createdAt`; `DeviceCredential.secretHash`, `DeviceCredential.label`, `DeviceCredential.deviceId`; `WebAuthnCredential.credentialId`, `WebAuthnCredential.publicKey`, `WebAuthnCredential.counter`; `WebAuthnChallenge.challenge`, `WebAuthnChallenge.expiresAt`; `OAuthHandoff.codeHash`, `OAuthHandoff.stateHash`, `OAuthHandoff.profileId`, `OAuthHandoff.expiresAt` (transient, 60 s) |
| **Lawful basis** | Art. 6(1)(b) contract — session management necessary to provide the service; Art. 6(1)(a) consent for passkey registration ceremony |
| **Retention** | Sessions: TTL-based expiry, automated cleanup (Phase 6); challenges: ephemeral, single-use, short expiry; credentials: until removed by user or account deletion. A device id is an opaque installation identifier kept only to name a device in the "Signed-in devices" panel; it authorises nothing and is deleted with its credential. `OAuthHandoff` rows: single-use and 60-second TTL; consumed atomically on exchange, expired rows swept at startup; they hold a pseudonymous profile id only and never a token |
| **Recipients** | Server only; session token in HttpOnly cookie (browser) or memory (Android) |
| **Cross-border transfer** | None |
| **Automated decision-making** | None |
| **System** | `server/src/auth/service.ts`, `routes.ts`, `session.ts`, `oauth.ts`, `passkeys.ts`; native handoff: `routes.ts` (`POST /api/auth/oauth/handoff`), `server/prisma/schema.prisma` model `OAuthHandoff` (ADR 030) |

---

## 3. Listening history & playback progress

| Field | Value |
|-------|-------|
| **Activity** | Storing per-profile listening position and full listening sessions |
| **Personal data** | `ListeningHistory.profileId`, `ListeningHistory.mediaItemId`, `startedAt`, `endedAt`, `fromPosition`, `toPosition`; `PlaySession.profileId`, `PlaySession.mediaItemId`, `position`, `playedAt` |
| **Lawful basis** | Art. 6(1)(f) legitimate interest — core service functionality, user expects progress to persist across devices; or Art. 6(1)(a) consent where opt-in |
| **Retention** | Per retention schedule (Phase 6); deleted on account erasure |
| **Recipients** | Server only; client receives own profile's progress |
| **Cross-border transfer** | None |
| **Automated decision-making** | None (progress is not used for profiling beyond recommendations, see Activity 8) |
| **System** | `server/prisma/schema.prisma` models `ListeningHistory`, `PlaySession`; `server/src/app.ts` routes `/api/audiobooks/:id/progress` |

---

## 4. Favourites

| Field | Value |
|-------|-------|
| **Activity** | Per-profile marking of favourite books |
| **Personal data** | `Favourite.profileId`, `Favourite.mediaItemId` |
| **Lawful basis** | Art. 6(1)(f) legitimate interest / Art. 6(1)(a) consent (user-initiated) |
| **Retention** | Until removed by user or account erasure |
| **Recipients** | Server only; client receives own profile's favourites |
| **Cross-border transfer** | None |
| **Automated decision-making** | Used as seed for tag-similarity recommendations (Activity 8), not profiling |
| **System** | `server/prisma/schema.prisma` model `Favourite`; spec 18 |

---

## 5. Wishlist

| Field | Value |
|-------|-------|
| **Activity** | Per-profile wishlist of books not owned |
| **Personal data** | `WishlistItem.profileId`, `WishlistItem.mediaItemId`, `WishlistItem.createdAt` |
| **Lawful basis** | Art. 6(1)(f) legitimate interest / Art. 6(1)(a) consent (user-initiated) |
| **Retention** | Until removed by user or account erasure |
| **Recipients** | Server only |
| **Cross-border transfer** | None |
| **Automated decision-making** | None |
| **System** | `server/prisma/schema.prisma` model `WishlistItem`; spec 19 |

---

## 6. Per-profile library membership

| Field | Value |
|-------|-------|
| **Activity** | Which books each profile has access to / follows |
| **Personal data** | `ProfileLibraryEntry.profileId`, `ProfileLibraryEntry.mediaItemId` |
| **Lawful basis** | Art. 6(1)(b) contract — library access is part of the service |
| **Retention** | Until entry removed or account erased |
| **Recipients** | Server only |
| **Cross-border transfer** | None |
| **Automated decision-making** | None |
| **System** | `server/prisma/schema.prisma` model `ProfileLibraryEntry`; spec 27 |

---

## 7. Admin credentials & sessions

| Field | Value |
|-------|-------|
| **Activity** | Admin panel access (break-glass / operator) |
| **Personal data** | `AdminCredential.credentialHash`; `AdminSession.tokenHash`, `AdminSession.expiresAt` |
| **Lawful basis** | Art. 6(1)(f) legitimate interest — security and administration of the service |
| **Retention** | Until credential rotated or admin session expires |
| **Recipients** | Server only |
| **Cross-border transfer** | None |
| **Automated decision-making** | None |
| **System** | `server/src/admin/auth.ts`, `server/prisma/schema.prisma` models `AdminCredential`, `AdminSession` |

---

## 8. Recommendations (tag-similarity, not profiling)

| Field | Value |
|-------|-------|
| **Activity** | Suggesting books based on a profile's favourites or a selected book |
| **Personal data** | Profile's favourites and wishlist (from Activities 4–5) used as seed; no new personal data stored |
| **Lawful basis** | Art. 6(1)(f) legitimate interest; user may object under Art. 21 (Phase 5) |
| **Retention** | Seed data retained per favourites/wishlist retention |
| **Recipients** | Server only; recommendations computed server-side from catalogue metadata |
| **Cross-border transfer** | None |
| **Automated decision-making** | **Not** automated decision-making with legal/similarly significant effect (Art. 22). Tag-similarity only, per spec 19 and ADR 010. |
| **System** | `server/src/metadata/` recommendation logic; spec 19; ADR 010 |

---

## 9. External catalogue enrichment (no personal data sent)

| Field | Value |
|-------|-------|
| **Activity** | Querying Open Library, Google Books (optional API key), LibriVox, Audnexus for book metadata; plus the spec-39 sheet-driven LibriVox lookup in `GET /api/buy-context` (title/author only, never logged, never persisted, in-memory 5-minute cache) |
| **Personal data** | **None** — only ISBN/title/author/ASIN queries; no user identifiers, no reading data |
| **Lawful basis** | N/A (no personal data processed) |
| **Retention** | N/A |
| **Recipients** | Third-party public APIs; responses stored in `MediaItem` (catalogue metadata, not personal data); the buy-context lookup stores nothing at all |
| **Cross-border transfer** | Possible (API providers may be outside EEA/UK), but no personal data is transferred |
| **System** | `server/src/enrichment.ts`, `metadata/chain.ts`, `metadata/audnexus.ts`, `metadata/librivox.ts`, `metadata/buy-context.ts`; spec 25, 39; ADR 008, 011, 034 |

---

## 10. Optional AI via LM Studio (local, optional)

| Field | Value |
|-------|-------|
| **Activity** | Metadata match assistant and description summary via LM Studio OpenAI-compatible API |
| **Personal data** | **None by default** — book metadata + folder names only; user confirms before applying. Degrades gracefully when offline. |
| **Lawful basis** | Art. 6(1)(a) consent if/when any user text is sent (not in current scope) |
| **Retention** | Summary cached in DB per media item (not per profile) |
| **Recipients** | Local LM Studio instance only (not a third party) |
| **Cross-border transfer** | None (local) |
| **Automated decision-making** | None — suggestions require user confirmation |
| **System** | `server/src/ai/llm.ts`; spec 12; ADR 012 |

---

## 11. Optional Supabase Storage sync (server-side, private bucket)

| Field | Value |
|-------|-------|
| **Activity** | Syncing audiobook files to Supabase Storage private bucket |
| **Personal data** | **None** — audiobook files and metadata are content, not user personal data |
| **Lawful basis** | N/A (no personal data processed) |
| **Retention** | Per file retention; deleted when source removed |
| **Recipients** | Supabase (processor) — server-side service-role key only; private bucket |
| **Cross-border transfer** | Possible per Supabase regions; no personal data transferred |
| **DPA** | Supabase DPA applies if enabled; confirm before enabling (`docs/processors.md`, Phase 7) |
| **System** | `server/src/admin/supabase-storage.ts` |

---

## 12. Age-appropriate content controls (kids accounts)

| Field | Value |
|-------|-------|
| **Activity** | Kids-account creation and management by the admin; storing a child's **age band**; per-book age ratings (admin-set or admin-confirmed); household genre blocklist; server-side and offline filtering of catalogue surfaces |
| **Personal data** | `Profile.ageBand` (one of `under-6`/`6-9`/`10-13`/`14-17`; only on `role = "child"` profiles; never a date of birth); `Profile.role` value `"child"` (an attribute of the account); `MediaItem.minimumAge` / `suggestedMinimumAge` / `suggestedMinimumAgeSource` (catalogue data, not personal data); `BlocklistGenre` rows (household configuration, not personal data) |
| **Lawful basis** | **Household deployment (primary):** Art. 2(2)(c) — processing by a natural person in the course of a purely personal or household activity is outside the Regulation's scope; the admin (parent/guardian) creates the account, chooses the band and exercises parental responsibility for the child's data. **Demo-ready documentation (kept in place deliberately):** Art. 6(1)(b) contract in the parent/guardian capacity — processing necessary to provide the service the parent contracted for; legitimate-interest balancing (Art. 6(1)(f)) is refreshed for it in `docs/gdpr-governance.md` §2; the processing is not profiling and involves no Art. 22 decision-making. If the feature is ever promoted to the production demo, an Art. 8 analysis and an Age Appropriate Design Code (AADC / Children's Code) review become mandatory — see `docs/dpia.md` |
| **Retention** | `Profile.ageBand`: deleted on self-service erasure (Phase 4) or admin deletion; 24-month inactivity purge otherwise. `MediaItem.minimumAge`/suggestions: catalogue data, deleted with the book; suggestions cleared on admin confirm/dismiss. `BlocklistGenre`: household configuration, deleted when the admin removes the genre from the blocklist. No new TTL machinery |
| **Recipients** | Server only; the child's own session payload carries their own `ageBand` (used to render the Kids-account label and the offline ladder); the admin panel shows it to the admin |
| **Cross-border transfer** | None |
| **Automated decision-making** | None — the age gate is a filtering rule under parental control, not profiling or evaluation; a child's Discover shelf draws only from age-suitable suggestions and excludes unverifiable ones |
| **System** | `server/src/age/` (`bands`, `policy`, `visibility`, `suggestion`, `blocklist`, `facts`); schema `Profile.ageBand`, `MediaItem.minimumAge`/`suggestedMinimumAge`/`suggestedMinimumAgeSource`, `BlocklistGenre`; admin routes `server/src/admin/child-accounts.ts`, `server/src/admin/age-ratings.ts`; enforcement in `routes/library.ts`, `routes/media.ts`, `routes/discover.ts`, `routes/taxonomy.ts`, `routes/progress.ts`, `routes/profiles.ts`, `routes/enrichment.ts`, `request-context.ts`; offline mirror `client/src/local/ageFilter.ts` + `local/librarySource.ts`; GDPR export selects `ageBand`; spec 38, ADR 033 |

---

## Client-side processing (device-local, not on server)

| Activity | Store | Protection | Notes |
|----------|-------|------------|-------|
| Private rows (progress, favourites, wishlist) | IndexedDB `privateRows` | AES-256-GCM per-profile DEK; DEK wrapped by scrypt KEK from profile password | `client/src/local/privateCache.ts` |
| Key envelopes | IndexedDB `keyEnvelopes` | Wrapped DEKs at rest only | `client/src/local/privateCache.ts` |
| Book replica + covers | IndexedDB `books`, `covers` | None (household content) | `client/src/local/db.ts` |
| Active profile + server URL + recent servers | `localStorage` | Plaintext identifiers only | `client/src/lib/api.ts`, `client/src/lib/recentServers.ts` |
| Explicit offline preference | `localStorage` | Boolean preference; contains no credential | `client/src/App.tsx` |
| Session token | Memory (Android) / HttpOnly cookie (browser) | — | `client/src/lib/api.ts` |
| Registration credentials | Form/request memory only | Household password is not saved; profile password is used to wrap the local cache key and is not persisted | `client/src/components/ProfileRegistration.tsx` |

---

## Special-category data

None processed. WebAuthn/passkeys use cryptographic credentials only; biometric templates never leave the user's device (spec 28, ADR 016). No health, genetic, or biometric data is stored.

## Children's data

Kids accounts (spec 38, ADR 033) are the children's-data mechanism the audit
was missing. A child account is a profile with `role = "child"` and a stored
**age band** (`under-6` | `6-9` | `10-13` | `14-17`) — never a date of birth
(data minimisation, Art. 5(1)(c)). The admin (parent/guardian) creates the
account, chooses the band and exercises parental responsibility for the
child's data; the household deployment is covered by Art. 2(2)(c), and the
full documentation set (this file, retention, governance register, DPIA,
remediation plan) is kept to demo-ready standard anyway.

What the system does:

- **Age ladder on books.** `MediaItem.minimumAge` (admin-set, null = unrated =
  visible) and provider-derived **suggestions** (`suggestedMinimumAge`, never
  auto-applied); a household **genre blocklist** (`BlocklistGenre`) hides
  blocklisted genres from every kids account regardless of rating.
- **Server-side filtering everywhere** for children: library grid, server
  library, single-book routes, covers/streams/media tokens, favourites,
  history, taxonomy counts, review queue (403) and Discover (unverifiable
  suggestions excluded). Hidden books answer **404**.
- **Self-service rights are unchanged**: a child exercises export, erasure and
  rectification exactly like a member (Art. 15–17). The account is deleted by
  the admin in the kids-accounts page or self-service via `/api/me`.
- **Offline/Android**: the replica filters with the same ladder (rating only;
  the genre blocklist is not evaluated offline). See `LIMITATIONS.md` §2.0.

If children use the **production demo**, an Art. 8 analysis and an
Age Appropriate Design Code review become mandatory and are tracked against
`GDPR-AUDIT.md` P1-5 and spec 33; the current demo remains general-audience.
The household analysis above does not extend to the hosted demo.

---

**Cross-reference:** `GDPR-AUDIT.md` §3 (data inventory), §4 (lawful basis), §5 (third-party processors), `server/prisma/schema.prisma` (canonical data model).