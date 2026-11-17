# GDPR Governance & Lawful-Basis Register

**Last updated:** 2026-11-17  
**Status:** Current — remediation Phases 1–9 complete; Phase 10 (final review/sign-off) in progress  
**References:** `docs/roa.md`, `GDPR-AUDIT.md`, `server/prisma/schema.prisma`

---

## 1. Data-protection role

The audiobook-manager is not a public authority and does not carry out large-scale systematic monitoring or large-scale processing of special-category data, so a statutory DPO under Art. 37 is not required. However, a **named data-protection lead** is assigned to own GDPR compliance:

| Role | Name / contact | Responsibilities |
|------|---------------|------------------|
| Data-protection lead | Household admin / deployment operator (TBD) | RoPA maintenance, privacy notice, data-subject-rights requests, breach response, DPIA sign-off, processor inventory |

**Contact for data-subject rights and GDPR queries:** the household admin email (production demo) or the deployment operator (household instance). This contact must be published in the privacy notice (Phase 2).

---

## 2. Lawful-basis register

Each processing activity from `docs/roa.md` is mapped to its Art. 6 basis below. No processing occurs without a documented basis.

| # | Activity (RoPA ref.) | Lawful basis | Conditions / notes |
|---|----------------------|--------------|--------------------|
| 1 | Profile & account management | Art. 6(1)(b) contract | Necessary to provide the service. OAuth/email sign-up in production demo additionally relies on Art. 6(1)(a) consent (opt-in sign-up). |
| 2 | Authentication & sessions | Art. 6(1)(b) contract | Session management is necessary to provide the service. Passkey registration additionally relies on Art. 6(1)(a) consent (WebAuthn ceremony). |
| 3 | Listening history & playback progress | Art. 6(1)(f) legitimate interest | Core service functionality; user expects progress to persist across devices. Right to object under Art. 21 (Phase 5). |
| 4 | Favourites | Art. 6(1)(f) legitimate interest / Art. 6(1)(a) consent | User-initiated. |
| 5 | Wishlist | Art. 6(1)(f) legitimate interest / Art. 6(1)(a) consent | User-initiated. |
| 6 | Per-profile library membership | Art. 6(1)(b) contract | Library access is part of the service. |
| 7 | Admin credentials & sessions | Art. 6(1)(f) legitimate interest | Security and administration of the service. |
| 8 | Recommendations (tag-similarity) | Art. 6(1)(f) legitimate interest | Not profiling under Art. 22; user may object under Art. 21. |
| 9 | External catalogue enrichment | N/A | No personal data is sent to third parties. |
| 10 | Optional AI via LM Studio | N/A by default | No user personal data sent; consent only if scope changes. |
| 11 | Optional Supabase Storage sync | N/A | No personal data processed; Supabase DPA applies if enabled. |
| 12 | Age-appropriate content controls (kids accounts) | Art. 2(2)(c) household exemption (primary, household deployment); Art. 6(1)(b) contract in the parent/guardian capacity (demo-ready documentation) | The admin (parent/guardian) creates the account, chooses the age band and exercises parental responsibility. Not profiling or Art. 22 processing — a household filtering rule. If ever promoted to the production demo, Art. 8 + an AADC review are mandatory (tracked in `GDPR-AUDIT.md` P1-5 / spec 33). See `docs/roa.md` activity 12. |

### Legitimate-interest balancing (Art. 6(1)(f))

Where legitimate interest is relied upon (activities 3, 4, 5, 7, 8, 12):

- **Purpose test:** The processing is needed for core service functionality (progress persistence, user-curated lists, security, recommendations) that users reasonably expect — and, for activity 12, for the safety layer the parent asked for (age-appropriate catalogue filtering for children).
- **Necessity test:** There is no less intrusive way to provide the service; data is profile-scoped and not shared. For children, the processing stores an **age band, never a date of birth** — the least data that answers the parental question.
- **Balancing test:** The data is minimal, household-scoped or demo-scoped, encrypted at rest client-side, and users can erase it via self-service (Phase 4). Users can object (Art. 21) and processing will stop unless compelling legitimate grounds override. For children the balancing is heightened: the band is the only age data held, the feature **reduces** exposure to unsuitable content, and no profiling, advertising or behavioural tracking is introduced.

---

## 3. Data-protection principles (Art. 5)

| Principle | How it is met | Gap / phase |
|-----------|---------------|-------------|
| Lawfulness, fairness, transparency | Lawful basis documented per activity; privacy notice served at `/privacy` (spec GDPR remediation Phase 2) | Done |
| Purpose limitation | Data collected for service functionality only; no secondary use | None |
| Data minimisation | Only fields needed for the service are stored; no biometric templates; no analytics | None |
| Data minimisation (children) | Kids accounts store an age band only — never a date of birth (spec 38) | None |
| Accuracy | Profile name/color editable; history entries deletable individually; self-service rectification (Phase 5) | Done |
| Storage limitation | Retention schedule defined (`docs/retention.md`, 7-newest ≈49 days; enforced) | Done |
| Integrity & confidentiality | scrypt password hashing, encrypted client cache, HttpOnly/Secure/SameSite cookies, path confinement, error hygiene | Android LAN HTTP gap (P0-5, Phase 8) |
| Accountability | This RoPA + governance doc + audit report | Ongoing |

---

## 4. Data-subject rights & handling

| Right | Art. | Status | Phase |
|-------|------|--------|-------|
| Access / export | 15, 20 | Implemented — `GET /api/me/export` (spec GDPR remediation Phase 3) | Done |
| Erasure ("be forgotten") | 17 | Implemented — self-service `DELETE /api/me`; admin deletion exists; cascade per `docs/retention.md` | Done |
| Rectification | 16 | Implemented — self-service profile edit (`PATCH /api/me`); kids age band rectifiable by admin | Done |
| Restriction | 18 | Implemented — `DELETE /api/me/listening-history/:id` and per-item favourites/wishlist erasure | Done |
| Object | 21 | No dedicated object toggle; objection is honoured via the self-service erasure/rectification paths above | Phase 5 (partial) |
| Portability | 20 | Covered by export (Phase 3) | Phase 3 |
| Withdraw consent | 7(3) | Not implemented where consent applies | Phase 5 |
| Complain to supervisory authority | 77(d) | Published in the privacy notice (`/privacy`) | Done |

All data-subject-rights requests go to the data-protection lead contact and must be answered within one month.

Children's rights requests (spec 38): the household admin (parent/guardian) may exercise them on the child's behalf, or the child self-serves identically to a member. The export (`/api/me/export`) includes the caller's own `ageBand`; erasure cascades exactly as for any member; the band can be rectified by the admin in the kids-accounts page.

---

## 5. Breach response roles (summary — full procedure in `docs/breach-procedure.md`, Phase 8)

- **Detection:** any team member or user reports; monitoring/alerts where available.
- **Containment:** data-protection lead decides isolation steps.
- **Assessment:** data-protection lead assesses risk to rights and freedoms.
- **Notification (supervisory authority):** within 72 hours of becoming aware, if high risk (Art. 33).
- **Communication (data subjects):** without undue delay if high risk (Art. 34).
- **Internal record:** all breaches documented regardless of notification requirement.

---

## 6. Review cycle

This governance document and the RoPA are reviewed:
- On every new feature that processes personal data (per AGENTS.md source-of-truth order),
- On every new external integration,
- At least annually,
- Before the production demo goes live.

---

**Next phase:** Phase 10 — final review (GDPR-REMEDIATION-PLAN.md); the privacy notice is live at `/privacy` and linked from the sign-in/account pages.