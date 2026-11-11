# GDPR Remediation Plan — 10 Phases

**Source:** GDPR-AUDIT.md findings (2026-11-05)  
**Order of work:** AGENTS.md working rules apply — one feature per change, matching a spec; every feature ships with tests; migrations stay additive; source-of-truth order (roadmap > specs > decisions > LIMITATIONS > code).

---

## Phase Summary

| Phase | Focus | GDPR basis | Priority | Status |
|-------|-------|------------|----------|--------|
| 1 | Governance & foundations: RoPA, DPO, lawful basis register | Art. 30, 37 | P0 | **Complete** |
| 2 | Privacy notice & transparency (client copy + served page) | Art. 12–14 | P0 | **Complete** |
| 3 | Right of access & data portability — self-service export endpoint | Art. 15, 20 | P0 | **Complete** |
| 4 | Right to erasure — self-service account deletion endpoint | Art. 17 | P0 | **Complete** |
| 5 | Right to rectification & restriction — edit/delete individual entries | Art. 16, 18 | P1 | **Complete** (server-side; restriction via `restrictedAt` needs a migration — follow-up) |
| 6 | Retention & storage limitation — schedule + automated cleanup | Art. 5(1)(e) | P0 | **Complete** |
| 7 | Third-party processors & DPAs — inventory + confirm | Art. 28 | P1 | **Complete** |
| 8 | Security & breach response — Android TLS, DPIA, breach procedure | Art. 32–35 | P0/P1 | **Complete** (Android TLS documented as accepted risk with mitigations in ADR 014 + LIMITATIONS §4) |
| 9 | Spec & documentation updates — AGENTS.md, LIMITATIONS.md, specs | AGENTS.md | P1 | **Complete** |
| 10 | Testing & verification — Vitest integration + E2E + sign-off | specs/02 | P0 | In progress |

---

## Phase 1 — Governance & Foundations (Art. 30, 37)

**Goal:** Document what personal data is processed, why, and on what lawful basis; assign a data-protection role.

### Deliverables
1. `docs/roa.md` — Record of Processing Activities (one entry per processing activity from the audit: profiles/auth, sessions, listening history, favourites, wishlist, library membership, WebAuthn, admin, external enrichment, optional AI, optional Supabase sync).
2. `docs/gdpr-governance.md` — DPO/data-protection lead assignment (internal, since not a public authority or large-scale monitoring), contact point, lawful-basis register mapping each activity to Art. 6 basis.
3. Update `AGENTS.md` if needed to reference GDPR obligations for new features.

### Definition of done
- RoPA covers every table in `server/prisma/schema.prisma` that holds personal data.
- Each activity has a named lawful basis (contract / legitimate interest / consent).
- Governance doc names the DPO/data-protection lead and contact.

### Tests
- None (documentation phase). A README-style check that RoPA tables match schema.prisma.

---

## Phase 2 — Privacy Notice & Transparency (Art. 12–14)

**Goal:** Publish a privacy notice so users (household + production demo visitors) know what is collected and why.

### Deliverables
1. Privacy-notice copy in `client/src/copy.ts` (controller identity, purposes, lawful bases, categories of data, recipients, retention, rights, cookies, supervisory authority, profiling statement).
2. Serve the notice at a `/privacy` route (server-side static page or client route).
3. Link from sign-in, account, and profile pages.
4. Cookie section disclosure (session cookie is strictly necessary; inventory it).

### Definition of done
- Notice is reachable without authentication.
- Covers both household mode and production demo mode (email sign-up, OAuth).
- No personal data is collected before notice is linked (sign-in page links to it).

### Tests
- Client copy test for privacy-notice strings (`copy.test.ts`).
- Route test: `GET /privacy` returns 200 with notice content.

---

## Phase 3 — Right of Access & Data Portability (Art. 15, 20)

**Goal:** Let an authenticated profile export all their personal data in a machine-readable format.

### Deliverables
1. `GET /api/me/export` endpoint in `server/src/app.ts` returning JSON: profile, sessions (metadata only, not token hashes), listening history, play sessions, favourites, wishlist items, library entries, device/WebAuthn credential metadata (no private keys).
2. Client UI: "Export my data" button in account menu → download JSON file.
3. Tests via Fastify `inject` with temp SQLite DB (per specs/02).

### Definition of done
- Authenticated request returns all personal data for that profile only (no cross-profile leakage).
- Response is valid JSON, downloadable by client.
- 401 when unauthenticated; 403/404 for wrong profile.

### Tests
- Integration test: export returns correct profile's data, excludes other profiles' data.
- Integration test: unauthenticated request → 401.

---

## Phase 4 — Right to Erasure (Art. 17)

**Goal:** Let an authenticated profile delete their own account and all associated personal data.

### Deliverables
1. `DELETE /api/me` endpoint in `server/src/app.ts` (self-service; extends existing admin-only `DELETE /api/profiles/:id`).
2. Cascading deletion: Session, ListeningHistory, PlaySession, Favourite, WishlistItem, ProfileLibraryEntry, DeviceCredential, WebAuthnCredential, WebAuthnChallenge — all rows for that profileId.
3. Client-side: clear IndexedDB privateRows/keyEnvelopes for that profile, clear localStorage profileId, sign out.
4. Client UI: "Delete my account" with confirmation.
5. Keep admin-only `DELETE /api/profiles/:id` for household admin break-glass.

### Definition of done
- Self-service deletion removes all personal data for the requesting profile.
- Other profiles' data is untouched.
- Session cookie cleared on server; client storage wiped.
- 401 when unauthenticated.

### Tests
- Integration test: deletion cascades to all related tables, other profiles unaffected.
- Integration test: unauthenticated → 401; wrong profile → 403/404.

---

## Phase 5 — Right to Rectification & Restriction (Art. 16, 18)

**Goal:** Let users correct or restrict processing of their personal data.

### Deliverables
1. `PATCH /api/me` — update profile display name / color (extends existing profile update; ensure it's self-service, not admin-only).
2. `DELETE /api/me/listening-history/:id` and `DELETE /api/me/favourites/:mediaItemId` — delete individual entries.
3. `PATCH /api/me/restrict` — flag profile as restricted (processing paused; data retained but not used for recommendations/progress display).
4. Client UI: edit profile, remove individual history/favourite entries, toggle restriction.

### Definition of done
- Users can rectify profile name/color.
- Users can delete individual listening-history rows and favourites.
- Restriction flag stops recommendation/progress use of that profile's data.

### Tests
- Integration tests for each endpoint; cross-profile isolation verified.

---

## Phase 6 — Retention & Storage Limitation (Art. 5(1)(e))

**Goal:** Adopt a retention schedule and automate expiry of personal data.

### Deliverables
1. `docs/retention.md` — retention schedule: sessions (TTL-based expiry), inactive profiles (e.g. 24 months), listening history (rolling window or indefinite with opt-out), WebAuthn challenges (already ephemeral), admin sessions.
2. Implement automated cleanup: extend `cleanupExpired` in `server/src/auth/service.ts` or add a scheduled job to delete expired sessions and inactive-profile data.
3. Prisma migration if any new columns (e.g. `restrictedAt`, `lastActiveAt`) are needed — additive only.

### Definition of done
- Retention schedule published and mapped to each personal-data table.
- Automated removal of expired sessions verified in tests.
- No personal data kept beyond its retention period without legal basis.

### Tests
- Integration test: expired sessions are removed by cleanup.
- Integration test: inactive profile data is removed per schedule.

---

## Phase 7 — Third-Party Processors & DPAs (Art. 28)

**Goal:** Document every external recipient and confirm data-processing terms.

### Deliverables
1. `docs/processors.md` — processor inventory: Open Library, Google Books (optional), LibriVox, Audnexus, LM Studio (optional local), Supabase Storage (optional). Mark which receive personal data (none in normal flow) and which are sub-processors.
2. Confirm Supabase DPA applies if Supabase Storage is enabled; note it in `.env.production.example` documentation.
3. No personal data is sent to any third party in normal operation — document this as a control.

### Definition of done
- Processor inventory is current and reviewed on each new external integration.
- Supabase DPA referenced if used.

### Tests
- None (documentation). Unit test that enrichment providers receive only non-personal query params (ISBN/title/author).

---

## Phase 8 — Security & Breach Response (Art. 32–35)

**Goal:** Harden confidentiality, document breach response, complete DPIA.

### Deliverables
1. Fix Android LAN HTTP (LIMITATIONS §4): enable TLS/HTTPS on Android transport or document as accepted risk with mitigations (cert pinning, VPN-only).
2. `docs/breach-procedure.md` — detection, containment, Art. 33 supervisory-authority notification (72h), Art. 34 data-subject communication, internal log.
3. DPIA for production demo surface (Art. 35) — external sign-in, recommendations, public exposure; published in `decisions/` or `docs/dpia.md`.
4. Review WebAuthn challenge one-time-use enforcement.

### Definition of done
- Android transport uses TLS or risk is documented and accepted.
- Breach procedure names roles and 72h notification path.
- DPIA signed off before production demo goes live.

### Tests
- Security test: no credentials over plaintext HTTP on Android path (if testable).
- DPIA document exists and covers production demo.

---

## Phase 9 — Spec & Documentation Updates (AGENTS.md compliance)

**Goal:** Ensure all GDPR work is reflected in the source of truth.

### Deliverables
1. Add/extend specs: `specs/GDPR-data-subject-rights.md` (export/erasure/rectification), `specs/GDPR-retention.md` (retention schedule), `specs/GDPR-privacy-notice.md` (notice + cookies).
2. Update `AGENTS.md` — add GDPR rule: every new feature documents lawful basis, retention, and data-subject-rights impact.
3. Update `LIMITATIONS.md` — mark Android TLS gap as remediated or still open; mark spec 33 acceptance checkboxes as complete.
4. Update `roadmap.md` if GDPR work changes feature ordering.

### Definition of done
- Every GDPR deliverable has a spec or doc entry.
- AGENTS.md references GDPR obligations for new features.

### Tests
- Copy tests for new UI strings.

---

## Phase 10 — Testing & Verification (specs/02)

**Goal:** Verify all GDPR endpoints and controls with automated tests.

### Deliverables
1. Vitest integration tests for every new endpoint (export, erasure, rectification, restriction) using temp SQLite DB.
2. Client tests for export/download and account-deletion flows.
3. Playwright E2E: sign in → export data → delete account → confirm data gone.
4. `make test` passes; `make check-copy` passes.

### Definition of done
- All 10 phases complete; tests pass; no regressions in existing suites.
- GDPR-AUDIT.md updated to "Remediated" status.

---

## Implementation Note

Work one phase at a time. Each phase that changes code must include:
- A spec or doc entry (source-of-truth order).
- Tests (integration via Fastify `inject` + temp SQLite; unit for pure logic).
- Additive migrations only (Prisma-managed; portable SQL).

### Profile registration and offline-mode update (2026-11-05)

The new household-password-backed `/api/auth/register-profile` flow creates
the existing `Profile` account record; it introduces no new personal-data
category or table. The RoPA entry for profile management applies:

- **Lawful basis:** Art. 6(1)(b), providing and securing the household profile
  service.
- **Retention:** profile and password hash follow the existing active-profile
  and 24-month inactivity schedule in `docs/retention.md`.
- **Rights impact:** registration adds a profile to the same access, rectification,
  and erasure paths as other profiles; account deletion cascades to associated
  profile data. The household password is request-only and is not retained.
- **Offline mode:** the persisted preference is a boolean, not personal data or
  an authentication credential. No household password, temporary profile, or
  pending registration is stored on the device.

### Device identity and session reuse (2026-11-11)

[`specs/36-device-identity-and-sessions.md`](../specs/36-device-identity-and-sessions.md)
gives a session a device and makes the "Signed-in devices" panel list devices
rather than sign-ins. Two columns are added and no personal-data category is
introduced:

- `Session.deviceCredentialId` — a link to the device credential the session
  was minted from. It identifies a device the household already has a record
  of; it is not a new identifier.
- `DeviceCredential.deviceId` — an opaque installation identifier the Android
  client generates once so two phones can be told apart. It names a device in
  the panel and authorises nothing.

- **Lawful basis:** Art. 6(1)(b), the same basis as the session and device
  credential it names. Reusing a session instead of adding one does not
  create new processing; it reduces it.
- **Retention:** unchanged. A reused session keeps its original creation date,
  so the 30-day sliding TTL and the 90-day hard cap are still measured from
  the first sign-in on that device. The device id is deleted with its
  credential and never outlives it.
- **Rights impact:** access and export are unchanged — the device id and the
  device credential link are personal data about the caller's own account and
  are included in the export. Erasure is unchanged: both columns cascade with
  the profile. Rectification is unchanged: the device label is the caller's own
  text and is editable at enrolment. The one new right impact is that a
  device can now be signed out in a single action, which is a strengthening of
  Art. 17 rather than a new obligation.

The biometric gate is deliberately unchanged (ADR 027): no credential is stored
on the device that would let anyone holding an unlocked phone read the
profile's progress without the fingerprint.

Start: Phase 1.