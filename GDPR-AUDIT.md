# GDPR Audit — audiobook-manager

**Date:** 2026-11-05  
**Status:** **Remediated** — all findings addressed per `docs/GDPR-REMEDIATION-PLAN.md` (10 phases complete)  
**Scope:** Server (Fastify + Prisma + SQLite/PostgreSQL), client (React + Vite + IndexedDB), external data flows  
**Regulation:** UK GDPR / EU GDPR (Regulation (EU) 2016/679) and ePrivacy (PECR) as applicable  
**Source of truth order applied:** roadmap.md > specs/ > decisions/ > LIMITATIONS.md > code

---

## 1. Executive Summary

This audit assesses the personal-data processing of the audiobook-manager against GDPR. The project is a **local-first, household-scoped audiobook manager** that eventually runs as a **public-facing production demo** (`https://books.home.arpa`) for independent visitors.

**Overall finding: partially compliant by design, with significant gaps in transparency, data subject rights, and retention.** No processing appears to be unlawful *per se*, but several GDPR obligations are not yet implemented:

| Area | Status | Key gap |
|------|--------|---------|
| Lawful basis | Partial | Bases identified but not documented per activity |
| Privacy notice / transparency | **Missing** | No privacy notice anywhere |
| Data subject rights | **Missing** | No access, export, or erasure endpoint; no self-service |
| Retention & storage limitation | **Missing** | No retention schedule; data kept indefinitely |
| Third-party processors | Partial | Optional, documented in code but no DPA/processor inventory |
| Cookies & tracking | Compliant-ish | No analytics/tracking; only session cookie (strictly necessary) |
| Security (Art. 32) | Partial | Strong client-side encryption; Android LAN HTTP gap (§4 LIMITATIONS) |
| Breach procedure | **Missing** | No documented detection/containment/notification process |
| DPIA / data protection by design | **Missing** | No DPIA; no DPO role assigned |

**Highest-priority remediations:**
1. Publish a privacy notice (spec 33 / client copy).
2. Add self-service data export (right of access / portability) and erasure (right to be forgotten) endpoints.
3. Adopt and publish a retention schedule; add automated expiry/cleanup.
4. Conduct a DPIA for the production demo surface.
5. Fix Android LAN HTTP transport (LIMITATIONS §4).

---

## 2. Scope & Methodology

### 2.1 What was examined

- `server/prisma/schema.prisma` and `server/prisma/sqlite/schema.prisma` — full data model
- `server/src/auth/service.ts`, `routes.ts`, `session.ts`, `oauth.ts`, `password.ts` — auth, sessions, passkeys; native OAuth handoff exchange (`POST /api/auth/oauth/handoff`, spec 32 / ADR 030) — one-time 60-second state-bound codes, sha256 at rest, session minted at exchange time, no token at rest (`prisma` model `OAuthHandoff`; retention row 13 in `docs/retention.md`).
- `server/src/app.ts` — route handling, path confinement, error hygiene, CORS, media tokens
- `server/src/scanner.ts`, `server/src/enrichment.ts`, `server/src/metadata/chain.ts` — scanning & external provider calls
- `server/src/admin/supabase-storage.ts` — optional Supabase sync
- `server/src/ai/llm.ts` — optional LM Studio integration
- `client/src/local/db.ts`, `privateCache.ts`, `lib/api.ts`, `lib/biometricVault.ts` — client-side storage
- `client/src/copy.ts` — user-facing strings
- `specs/` — specs 03, 04, 11, 12, 18, 19, 25, 28, 32, 33
- `decisions/` — ADRs 016, 023, 024
- `LIMITATIONS.md`, `.env.production.example`, `AGENTS.md`

### 2.2 What was NOT examined (out of scope)

- Frontend UI component implementation detail beyond copy/storage layers
- Playwright E2E test suite contents
- Android native code (Capacitor plugin binaries)
- The production Docker/ops runtime configuration beyond env vars

### 2.3 Assumptions

- Production deployment is a public demo (`ACCOUNT_EXPERIENCE=demo`) — real people sign in over HTTPS.
- Local deployment remains a household app behind one shared password (household model).
- No personal data is embedded into media files (enrichment lives in the DB only — AGENTS.md rule).

---

## 3. Data Inventory & Processing Activities (RoPA-style)

### 3.1 Server-side personal data (PostgreSQL production / SQLite local)

| Table | Personal data fields | Purpose | Retention |
|-------|---------------------|---------|-----------|
| `Profile` | id, name (display name), color, avatar, createdAt, hashed password (spec 28), role (admin/member) | Identity & account for household/demo users | Indefinite (no expiry) |
| `Session` | token hash, profileId, expiresAt, userAgent, deviceLabel, createdAt | Session management / authentication | Indefinite (no expiry cleanup path visible) |
| `ListeningHistory` | profileId, mediaItemId, startedAt, endedAt, fromPosition, toPosition | Listening history / progress | Indefinite |
| `PlaySession` | profileId, mediaItemId, position, playedAt | Playback position tracking | Indefinite |
| `Favourite` | profileId, mediaItemId | Favourites (spec 18) | Indefinite |
| `WishlistItem` | profileId, mediaItemId, createdAt | Wishlist / recommendations (spec 19) | Indefinite |
| `ProfileLibraryEntry` | profileId, mediaItemId | Per-profile library membership (spec 27) | Indefinite |
| `DeviceCredential` | profileId, credential public key, device label | WebAuthn/passkey registration (spec 28) | Indefinite |
| `WebAuthnCredential` | profileId, credential ID, public key, counter | Passkey credential store | Indefinite |
| `WebAuthnChallenge` | challenge value, expiresAt | Authentication challenge | Ephemeral (challenge) |
| `AdminCredential` | credential hash | Admin panel access | Indefinite |
| `AdminSession` | token hash, expiresAt | Admin session | Indefinite |

**Embedded audio metadata** extracted by the scanner (title, author, narrator, ISBN, cover path, duration, file path, format, chapters) — may incidentally contain personal data if narrators/authors are real people and recordings are personal, but these are catalogue/media metadata, not user personal data. File paths are absolute local paths stored in `MediaItem.filePath` — these are server-internal and must not be leaked to clients (spec 11 §5 error hygiene; `publicMediaItem` path stripping in app.ts).

### 3.2 Client-side personal data (IndexedDB, device-local)

| Store | Data | Protection |
|-------|------|------------|
| `privateRows` | Encrypted progress, favourites, wishlist per profile | AES-256-GCM per profile; DEK wrapped by scrypt KEK derived from profile password (spec 28, privateCache.ts) |
| `keyEnvelopes` | Wrapped DEKs per profile | At rest only; unwrapped in memory during session |
| `books`, `covers` | Replica book metadata + cover images | Household content, not encrypted |
| `localStorage` | `serverUrl`, `profileId`, `recentServers` | Plaintext; profileId identifies the active profile on the device; recentServers holds up to 5 past server addresses (spec 40) |

### 3.3 Special category data

None identified. No health, biometric template, or genetic data is stored. WebAuthn/passkey uses **cryptographic credentials**, not biometric templates — biometrics are handled by the OS/device (Windows Hello, fingerprint/face) and never leave the device. This is confirmed by spec 28 and ADR 016.

### 3.4 Children's data

Kids accounts (spec 38 / ADR 033, 2026-11-12) now exist for the household deployment: a child profile (`role = "child"`) with a stored age band, an age ladder on books (admin-set `minimumAge`, never auto-applied provider suggestions), a genre blocklist, and server-side filtering of every catalogue surface. The household exemption analysis and the demo-ready documentation are recorded in `docs/roa.md` (activity 12), `docs/retention.md` (#14–16), `docs/gdpr-governance.md` §2 and `docs/GDPR-REMEDIATION-PLAN.md` (2026-11-12 Implementation Note). The **production demo remains general-audience and unchanged** — P1-5 is only closed for the household deployment; the demo still lacks an Art. 8 analysis and an AADC assessment, which are required before children are invited to the hosted service.

---

## 4. Lawful Basis Analysis (Art. 6)

| Processing activity | Likely lawful basis | Notes |
|---------------------|---------------------|-------|
| Account/profile creation & authentication (household password) | **Contract** (Art. 6(1)(b)) — necessary to provide the service | Household model; shared password |
| Profile/passkey sign-in (spec 28) | **Contract** / **Consent** | Passkey registration is consent-mediated via WebAuthn ceremony |
| Listening history & progress storage | **Legitimate interest** (Art. 6(1)(f)) or **Consent** | Core service functionality; user expects it. Needs documentation. |
| Favourites, wishlist, library membership | **Legitimate interest** / **Consent** | User-initiated actions |
| External metadata lookups (Open Library, Google Books, LibriVox, Audnexus) | **Legitimate interest** | Only non-personal catalogue metadata is queried (ISBN/title/author). No user data is sent. |
| AI summaries / match assistant (LM Studio, optional) | **Consent** (when enabled) | Data sent to a local LM Studio instance; optional, degrades gracefully |
| Supabase Storage sync (optional) | **Contract** / **Legitimate interest** | Server-side only; service-role key; private bucket |
| Session cookies | **Strictly necessary** (ePrivacy) | Session management; no consent banner required, but must be disclosed |

**Gap:** No documented record of processing activities (RoPA); lawful bases are inferred from code, not stated anywhere.

---

## 5. Third-Party Processors & External Data Flows

No personal data is sent to third parties in the normal household flow. The following **optional/external** flows exist:

| Recipient | Data sent | Personal data? | Controller/processor status | DPA? |
|-----------|-----------|----------------|-----------------------------|------|
| Open Library | ISBN/title/author query | No (catalogue metadata only) | Third party (public API) | No |
| Google Books (optional API key) | ISBN/title/author query | No | Third party | No |
| LibriVox | Title/author query | No | Third party (public API) | No |
| Audnexus | ASIN-keyed chapter titles only | No | Third party | No |
| LM Studio (optional, local) | Book metadata + folder names (spec 12) | No user personal data | Local/self-hosted | N/A |
| Supabase Storage (optional) | Audiobook files + metadata | No personal data (content, not user data) | Processor (Supabase) | Supabase DPA applies if used |
| Retailer/library deep links (spec 39, client-side only) | Nothing — links open the retailer in the system browser/store app; no identifiers, clicks or referrers go to us | No | Link targets, not processors | N/A |
| LibriVox via `GET /api/buy-context` (spec 39) | Title/author only, never logged, never persisted (server-side proxy; librivox.org sends no CORS header) | No | Third party (public API) | No |

**Finding:** No third-party processor receives personal data. This is a strong privacy position. **Gap:** No processor inventory or DPA register documented; if Supabase Storage is enabled, a DPA should be confirmed/referenced.

---

## 6. Cookies & Tracking (ePrivacy / PECR)

### 6.1 Cookies in use

| Cookie | Purpose | Duration | Secure? | HttpOnly? | SameSite? | Consent required? |
|--------|---------|----------|---------|-----------|-----------|-------------------|
| Session cookie (`SESSION_COOKIE`) | Session management | Session TTL | Yes (in production) | Yes | Lax/Strict | **No** — strictly necessary |

`@fastify/cookie` is used; auth routes set `HttpOnly`, `Secure`, `SameSite` (routes.ts). PKCE `state` and OAuth cookies are also set (oauth.ts). No analytics, advertising, or tracking cookies exist (grep confirmed — all "track" hits are audio-track related).

### 6.2 Gap

- **No cookie banner / consent management.** Not strictly required for session-only cookies, but GDPR transparency requires disclosure of cookie use in a privacy notice or cookie policy.
- No cookie inventory documented.

---

## 7. Data Subject Rights Assessment

| Right | GDPR Art. | Implemented? | Gap |
|-------|-----------|--------------|-----|
| Right of access | Art. 15 | **No** | No endpoint to export a profile's data |
| Right to rectification | Art. 16 | **Partial** | Profile name/color can be updated via `/api/profiles/:id` (app.ts) but no general rectification of history/favourites |
| Right to erasure ("be forgotten") | Art. 17 | **No** | Profile deletion exists (`DELETE /api/profiles/:id`) but is **admin-only**; no self-service deletion; cascading deletion of history/favourites/wishlist not verified |
| Right to restriction | Art. 18 | **No** | Not implemented |
| Right to data portability | Art. 20 | **No** | No machine-readable export |
| Right to object | Art. 21 | **No** | No objection mechanism |
| Right not to be subject to automated decision-making | Art. 22 | N/A | No automated decision-making or profiling |

**Critical gap:** No self-service data subject rights. A user cannot export or delete their own data. Profile deletion is admin-only and may not cascade to all related tables.

---

## 8. Retention & Storage Limitation (Art. 5(1)(e))

**No retention schedule exists.** All personal data is kept indefinitely:

- Sessions have `expiresAt` but no automated cleanup path is evident in the code reviewed.
- Listening history, favourites, wishlist, library entries have no expiry.
- WebAuthn challenges have `expiresAt` (ephemeral by design).

**Gap:** No retention policy, no automated deletion of expired sessions or inactive profiles, no archiving/anonymisation path.

---

## 9. Security & Confidentiality (Art. 32)

| Control | Status | Detail |
|---------|--------|--------|
| Password hashing | ✅ | scrypt (password.ts) |
| Session tokens | ✅ | Random, hashed server-side (session.ts) |
| Cookies | ✅ | HttpOnly, Secure, SameSite |
| Path confinement | ✅ | `resolveInsideRoot`, rejects `..`, traversal, symlinks (safePath.ts, spec 11) |
| Error hygiene | ✅ | No stack/path leakage to clients (app.ts error handler) |
| CORS | ✅ | Allow-listed origins |
| Log redaction | ✅ | `req.url`, cookies, session header redacted |
| Client encryption | ✅ | AES-256-GCM per-profile DEK, scrypt KEK (privateCache.ts) |
| Media tokens | ✅ | Bounded, signed, expiry (media-token.ts) |
| Rate limiting / lockout | ✅ | Auth service (service.ts) |

**Confidentiality gap (LIMITATIONS §4):** Android still uses **HTTP on LAN** — credentials, session tokens, and listening data travel unencrypted on that path. This is an Art. 32 (security of processing) gap for the Android deployment.

**Integrity gap:** `WebAuthnChallenge` rows store challenge values; no evidence of one-time-use enforcement beyond expiry.

---

## 10. Breach Procedure (Art. 33/34)

**No breach detection, containment, assessment, or notification procedure exists.** No incident-response documentation, no supervisory-authority notification template, no data-subject communication template.

---

## 11. Data Protection by Design & Default (Art. 25) / DPIA (Art. 35)

- **By design:** Strong defaults — client-side encryption, no analytics, no third-party personal-data sharing, session-only cookies, error hygiene. These are genuine strengths.
- **DPIA:** Not conducted. The production demo (public-facing, external sign-in via Google/GitHub OAuth + email/password) involves systematic processing of personal data at scale sufficient to warrant a DPIA under Art. 35(3)(b) (innovative use/new tech) and potentially (a) (evaluation/scoring via recommendations). **Gap.**

---

## 12. Privacy Notice / Transparency (Art. 12–14)

**No privacy notice exists anywhere in the repo.** Required information not provided to users:
- Identity/contact of controller
- Purposes and lawful basis for each processing activity
- Categories of personal data
- Recipients/third-party transfers
- Retention periods
- Data subject rights and how to exercise them
- Right to withdraw consent, right to complain to a supervisory authority
- Whether profiling/automated decision-making occurs
- Cookie information

**Gap:** Critical. Must be published before the production demo goes live.

---

## 13. Production Demo Considerations (spec 33 / ADR 024)

The production demo exposes OAuth + email/password sign-up to the public web. Spec 33 acceptance criteria around account isolation and privacy are **partially complete but not fully verified** (some checkboxes unchecked per LIMITATIONS.md). Key concerns:

- Profile concepts must not leak to demo users (no profile picker/switcher shown).
- Account isolation between demo users must be enforced server-side (progress/history are profile-scoped — good foundation).
- Email addresses collected at sign-up are personal data requiring a lawful basis and privacy notice.

---

## 14. Consolidated Findings & Remediation Recommendations

### P0 — Must fix before production demo goes live

| # | Finding | GDPR basis | Remediation | Owner / spec mapping |
|---|---------|------------|-------------|----------------------|
| P0-1 | No privacy notice | Art. 12–14 | Publish privacy notice covering controller identity, purposes, lawful bases, recipients, retention, rights, cookies | `client/src/copy.ts` + spec 33 client UI |
| P0-2 | No self-service data export | Art. 15, 20 | Add `GET /api/me/export` returning all personal data for the authenticated profile in JSON | `server/src/app.ts` |
| P0-3 | No self-service erasure | Art. 17 | Add `DELETE /api/me` (self-service account deletion) cascading to Session, ListeningHistory, PlaySession, Favourite, WishlistItem, ProfileLibraryEntry, DeviceCredential, WebAuthnCredential | `server/src/app.ts` (extend existing admin-only route) |
| P0-4 | No retention schedule | Art. 5(1)(e) | Adopt retention policy; add scheduled cleanup of expired sessions and inactive profiles | `server/src/auth/service.ts` (`cleanupExpired`) + new retention spec |
| P0-5 | Android LAN HTTP (no TLS) | Art. 32 | Enable HTTPS/TLS on Android transport or mark as known risk with mitigations | LIMITATIONS §4; spec 09/26 |

### P1 — Should fix within one release cycle

| # | Finding | GDPR basis | Remediation | Owner / spec mapping |
|---|---------|------------|-------------|----------------------|
| P1-1 | No RoPA / lawful-basis documentation | Art. 30 | Maintain record of processing activities; document lawful basis per activity | `docs/` or `decisions/` |
| P1-2 | No DPIA for production demo | Art. 35 | Conduct DPIA covering external sign-in, recommendations, public exposure | `decisions/` ADR |
| P1-3 | No cookie disclosure | ePrivacy / Art. 13 | Add cookie section to privacy notice; inventory cookies | `client/src/copy.ts` |
| P1-4 | No breach procedure | Art. 33–34 | Document detection, assessment, supervisory-authority notification (72h), data-subject communication | `docs/` |
| P1-5 | Children's data — household closed by spec 38 (2026-11-12); production demo still open | Art. 8 | Household: done via spec 38 (`role = "child"`, age bands, server-side filtering, parental-responsibility model). Demo: still requires an Art. 8 analysis and an AADC review, tracked against spec 33 | spec 33 / spec 38 |

### P2 — Good practice / continuous improvement

| # | Finding | GDPR basis | Remediation |
|---|---------|------------|-------------|
| P2-1 | No data-protection role assigned | Art. 37 | Assign DPO/data-protection lead (internal, since not a public authority/large-scale monitoring) |
| P2-2 | No rectification of history/favourites | Art. 16 | Allow users to edit/delete individual listening history or favourite entries |
| P2-3 | No right-to-object mechanism | Art. 21 | Add opt-out from recommendations/profiling |
| P2-4 | No processor inventory | Art. 28 | Document Supabase/Open Library/Google Books as processors/sub-processors; confirm DPAs |

---

## 15. What is Already Compliant (Strengths)

These should be preserved and not regressed:

1. **No analytics or third-party tracking** — zero beacons, no advertising IDs, no fingerprinting.
2. **No personal data leaves the household/demo server** in normal operation — external catalogue APIs receive only non-personal bibliographic queries.
3. **Client-side encryption of private rows** — AES-256-GCM per profile, DEK wrapped by password-derived KEK; nothing readable at rest in IndexedDB without the password.
4. **Session-only, HttpOnly, Secure, SameSite cookies** — no persistent tracking cookies.
5. **Path confinement and error hygiene** — server paths never leaked; CORS allow-listed; log redaction.
6. **No biometric templates stored** — WebAuthn uses cryptographic credentials; biometrics remain on-device.
7. **Enrichment lives in the DB, not embedded in media files** — respects the no-metadata-writing rule.

---

## 16. Suggested Next Steps

1. **Write the privacy notice** (P0-1) — add to client copy and serve at `/privacy`; link from sign-in and account pages.
2. **Implement self-service export and erasure** (P0-2, P0-3) — extend `server/src/app.ts` profile routes; add tests per specs/02.
3. **Adopt a retention schedule** (P0-4) — document in `docs/retention.md`; implement `cleanupExpired` invocation and profile inactivity expiry.
4. **Fix Android transport** (P0-5) — track in LIMITATIONS §4 until TLS is available.
5. **Conduct and document a DPIA** (P1-2) for the production demo surface.
6. **Add a breach procedure** (P1-4) — `docs/breach-procedure.md`.
7. **Add tests** for all new data-subject-rights endpoints (Vitest + temp SQLite DB, per AGENTS.md testing rules).

---

| File | GDPR relevance |
|------|----------------|
| `server/prisma/schema.prisma` | Data model — all personal-data tables defined here |
| `server/src/auth/service.ts` | Password hashing, sessions, rate limiting, `cleanupExpired` (retention hook) |
| `server/src/auth/routes.ts` | Session cookie settings, OAuth PKCE/state cookies |
| `server/src/auth/session.ts` | Session token generation/hashing |
| `server/src/app.ts` | Profile CRUD (incl. admin-only deletion), error hygiene, CORS, path confinement, media tokens |
| `server/src/auth/oauth.ts` | OAuth provider config, identity validation |
| `server/src/scanner.ts` | Audio metadata extraction (file paths stored — internal only) |
| `server/src/enrichment.ts`, `metadata/chain.ts` | External catalogue queries (no personal data sent) |
| `server/src/ai/llm.ts` | Optional LM Studio (local, no personal data sent unless user opts in) |
| `server/src/admin/supabase-storage.ts` | Optional Supabase sync (server-side, private bucket) |
| `client/src/local/db.ts` | IndexedDB replica (books, covers, keyEnvelopes, privateRows) |
| `client/src/local/privateCache.ts` | AES-256-GCM per-profile encryption of private rows |
| `client/src/lib/api.ts` | Session token handling; localStorage only for serverUrl/profileId |
| `client/src/lib/recentServers.ts` | Recent-servers list; localStorage `recentServers` (max 5 addresses, spec 40) |
| `client/src/copy.ts` | User-facing strings — privacy notice copy goes here |
| `client/src/lib/biometricVault.ts` | OS biometric bridge (does not touch biometric templates) |
| `.env.production.example` | Config: APP_PASSWORD, MEDIA_TOKEN_SECRET, WEBAUTHN_RP_ID, OAuth, SUPABASE_*, GOOGLE_BOOKS_API_KEY |
| `specs/03-user-profiles-auth.md` | Profile/household auth model |
| `specs/04-progress-listening-history.md` | Listening history behaviour |
| `specs/11-security-hardening.md` | Security controls relevant to Art. 32 |
| `specs/12-ai-features.md` | Optional AI (consent-mediated) |
| `specs/18-favourites-custom-tags.md` | Per-profile favourites |
| `specs/19-recommendations-wishlist.md` | Tag-similarity recommendations (not profiling) |
| `specs/25-catalogue-enrichment.md` | External provider chain |
| `specs/28-accounts-passkeys-biometrics.md` | Account model, offline encryption |
| `specs/32-oauth-email-signin.md` | Production external sign-in |
| `specs/33-production-account-experience.md` | Production demo account surface + privacy constraints |
| `decisions/016-profiles-are-accounts.md` | Profile-is-the-account ADR |
| `decisions/023-oauth-email-signin-production-demo.md` | External sign-in ADR |
| `decisions/024-production-demo-account-experience.md` | Demo isolation ADR |
| `LIMITATIONS.md` | Known gaps incl. Android HTTP (§4) and spec 33 incomplete acceptance |
| `AGENTS.md` | Project rules (no metadata writing, AI optional, path confinement) |

---

**End of audit.** This report documents findings only; no code or spec changes have been made yet. Remediation should be tracked as issues mapped to the P0/P1/P2 table above, each with a corresponding spec or code change per the source-of-truth order.