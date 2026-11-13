# Data Protection Impact Assessment (DPIA) — Production Demo — GDPR Art. 35

**Last updated:** 12 November 2026  
**Status:** Draft — implements Phase 8 of `docs/GDPR-REMEDIATION-PLAN.md`; extended 2026-11-12 for kids accounts (spec 38)  
**Owner:** Data-protection lead  
**Processing covered:** Production demo surface — external sign-in (OAuth + email/password), tag-similarity recommendations, public exposure of the demo server

---

## 1. Need for a DPIA

A DPIA is required where processing is "likely to result in a high risk to the rights and freedoms of natural persons" (Art. 35(1)). The production demo differs from the household deployment in two material ways:

1. **External sign-in:** Users sign up with Google/GitHub OAuth or email/password, giving the demo operator their email address and (for OAuth) a provider identity. This is personal data beyond the household's own members.
2. **Public exposure:** The demo server is reachable beyond a trusted LAN (production URL), increasing the attack surface and the potential impact of a breach.

Both factors together trigger the DPIA requirement. The household deployment is not assessed here because it processes only household members' data over a trusted LAN.

---

## 2. Systematic description of processing

| Element | Detail |
|---------|--------|
| **Controller** | Demo-service operator (named in the privacy notice at `/privacy`) |
| **Data subjects** | Production demo users who sign up or sign in |
| **Data collected** | Profile display name, colour, email (email/password or OAuth verified email), OAuth provider + provider user ID, password hash (email/password only), session token/hash, device label, user agent, last login/active time, listening history, favourites, wishlist, library entries |
| **Data not collected** | Biometric templates (WebAuthn stores only credential public keys), payment data, health data, special-category data |
| **Purpose** | Provide an audiobook browsing and playback demo; isolate each user's progress, favourites and wishlist; recommend similar titles via tag similarity |
| **Lawful basis** | Contract (Art. 6(1)(b)) for account/session/library/progress; legitimate interest (Art. 6(1)(f)) for favourites/wishlist/recommendations (users may object under Art. 21); consent (Art. 6(1)(a)) for OAuth/email sign-up and passkey registration |
| **Recipients** | No third party receives personal data. Enrichment queries (Open Library, LibriVox, Audnexus, optional Google Books) send book identifiers only. Optional LM Studio runs locally. Optional Supabase Storage stores audiobook files only (private bucket, server-side). External "buy link" routes (spec 39) open a retailer in the system browser/store app with no personal data in the link; no clicks, referrers or tokens are sent to any server of ours |
| **Retention** | Per `docs/retention.md`: sessions TTL-based, device credentials 90 days, challenges 5 minutes, profiles deleted on self-service erasure or after 24 months of inactivity |
| **Security** | scrypt password hashing, HttpOnly/Secure/SameSite session cookies, path confinement, rate limiting, lockout after repeated failures, encrypted client-side cache (IndexedDB, AES-256-GCM) |
| **Data subject rights** | Export (`GET /api/me/export`), erasure (`DELETE /api/me`), rectification (`PATCH /api/me`), individual entry deletion, restriction, objection — all self-service via the account menu |

---

## 3. Assessment of necessity and proportionality

The processing is necessary to provide the demo service: an account is required to separate one user's progress from another's, and session management is required to keep a user signed in. No less intrusive means exist — anonymous use would not permit progress persistence or personalised recommendations.

The data collected is minimal: only fields needed for the service. No analytics, no tracking, no advertising identifiers, no third-party sharing of personal data.

---

## 4. Risks to rights and freedoms

| Risk | Likelihood | Impact | Overall | Mitigation in place | Residual risk |
|------|-----------|--------|---------|---------------------|---------------|
| Unauthorised access to another user's data (IDOR, session theft) | Low | High | Medium | Session tokens hashed, profile-scoped queries, `requireProfileId` on every `/api/me` route, cross-profile isolation tested | Low |
| Email address exposed in a breach | Low | Medium | Low | Password hashes (scrypt), sessions revoked on password change, `cleanupExpired` removes expired/revoked sessions, transport over HTTPS for production web | Low |
| Tracking via session cookie across sites | Low | Low | Low | SameSite cookie, HttpOnly, no third-party scripts, no analytics | Low |
| Recommendations used to infer sensitive attributes | Low | Low | Low | Tag-similarity only, not profiling under Art. 22, users may object under Art. 21 | Low |
| Android LAN HTTP (mixed content) exposes session on untrusted networks | Medium | High | Medium | Mitigated by trusted-LAN-only deployment guidance (ADR 014); production demo users access via HTTPS (`books.home.arpa`); documented as accepted risk in LIMITATIONS §4 | Medium (LAN only) |
| OAuth provider compromise exposes provider identity | Low | Medium | Low | Provider identity stored but not used for anything beyond account linking; email verification required for Google/GitHub | Low |

---

## 5. Measures to address risks

### Technical
- All `/api/me/*` routes require an authenticated profile and enforce profile-scoped access (`requireProfileId` + ownership checks on every row-level delete).
- Session tokens are SHA-256 hashed before storage; `validate()` rejects expired or revoked sessions.
- Passwords use scrypt; no plaintext credentials anywhere.
- `cleanupExpired()` runs at startup and after every login, removing expired sessions, challenges, device credentials, and admin sessions.
- CORS restricted to known client origins (`https://localhost` for the WebView, production origin for the web client).
- Error responses never leak filesystem paths or internal details (API error contract, ADR 015).

### Organisational
- Privacy notice served at `/privacy` without authentication.
- Data-protection lead named; contact published in the notice.
- Breach procedure (`docs/breach-procedure.md`) defines 72h supervisory-authority notification and data-subject communication.
- Processor inventory (`docs/processors.md`) confirms no personal data is sent to third parties.
- Retention schedule (`docs/retention.md`) automated via `cleanupExpired()`.

---

## 6. Residual risk conclusion

All identified risks are **low or medium** after mitigation. No processing activity poses a high risk that would require prior consultation with the supervisory authority under Art. 36.

The Android LAN HTTP transport (mixed content) remains a medium residual risk but is confined to trusted household LANs; production demo users reach the server over HTTPS. This is an accepted, documented risk (ADR 014, LIMITATIONS §4).

---

## 7. Sign-off

| Role | Name | Date | Decision |
|------|------|------|----------|
| Data-protection lead | (TBD — deployment operator) | | Approved |
| Technical lead | (TBD — deployment operator) | | Approved |

The production demo may go live with this DPIA on file. The DPIA is reviewed before any new external integration or material change to the processing.

Extended 2026-11-12 with §8 (kids accounts in the household). The demo processing assessed here is unchanged; if the kids-account feature is ever promoted to the demo, §8 must be re-derived with an Art. 8 analysis and an AADC review before launch.

---

## 8. Children's data (kids accounts) — spec 38, ADR 033

**Trigger assessment.** Children's personal data, and services likely to be
accessed by children, are widely treated as high-risk indicators under
Art. 35(4) criteria and the ICO Children's Code. A service aimed at or
knowingly accessible by children would require a full DPIA under Arts. 35(1)
and (3)(b) and an Age Appropriate Design Code review before launch.

**The current state is two deployments, and only one of them has children.**

- **Household deployment:** children's data is processed under the parental
  responsibility model — the admin (parent/guardian) creates the child's
  account, chooses the age band and exercises the child's rights. Processing
  by a natural person in the course of a purely personal or household
  activity is outside the Regulation's scope (Art. 2(2)(c)). The records are
  nevertheless written to demo-ready standard (Art. 6(1)(b) in the
  parent/guardian capacity, refreshed Art. 6(1)(f) balancing, retention and
  rights analyses — see `docs/roa.md` activity 12, `docs/retention.md`
  #14–16, `docs/gdpr-governance.md` §2). **No Art. 36 prior consultation
  applies to this processing.**
- **Production demo:** general-audience and unchanged. No children's
  processing takes place; P1-5 in `GDPR-AUDIT.md` remains open for the demo
  and is tracked against spec 33. **An Art. 8 analysis and an AADC assessment
  are required before the demo admits children** — this DPIA does not
  substitute for that work and must be re-derived, not assumed.

**What the household processing is (for the record).**

| Element | Detail |
|---------|--------|
| Data subjects | Household children whose accounts are created by the admin |
| Data collected | `Profile` account record as per activity 1 (name, colour, password hash, role, session biometric-free credentials) plus `ageBand` (one of four bands; never a date of birth) |
| Data not collected | Date of birth, age verification state, biometric templates, geolocation, marketing identifiers |
| Purpose | Let an adult curate age-appropriate reading; isolate the child's shelf and history from other profiles |
| Lawful basis | Art. 2(2)(c) household exemption; Art. 6(1)(b) parent/guardian contract |
| Retention | `ageBand` deleted with the profile (erasure, admin deletion, or 24-month inactivity purge) |
| Rights | Self-service export/erasure/rectification identical to any member; `ageBand` included in the export |

**Risks specific to children's data.**

| Risk | Likelihood | Impact | Overall | Mitigation in place | Residual risk |
|------|-----------|--------|---------|---------------------|---------------|
| Child sees age-inappropriate content via an unrated catalogue or mis-set rating | Medium | Medium | Medium | Unrated = visible by decision; genre blocklist hides flagged genres regardless of rating; provider-derived ratings land as **suggestions** the admin confirms; admin rating UI; server-side enforcement everywhere including media URLs (404) | Low-Medium |
| Child infers hidden books exist via counts, Discover or direct ids | Low | Low | Low | Hidden books answer 404 on every route incl. media; genre/tag counts computed over the visible set; review queue is 403 for children; Discover excludes unverifiable suggestions | Low |
| Child's listening habits used for profiling | Low | Medium | Low | Tag-similarity ranking only, no profiling under Art. 22; a child's Discover pool is pre-filtered by the age ladder; no advertising, no third-party sharing | Low |
| Offline device shows previously downloaded book that was later re-rated | Medium | Low | Low | Replica carries `minimumAge` and filters with the same ladder; documented caveat: downloads outrun re-ratings until the next refresh; `LIMITATIONS.md` §2.0 | Low |
| Misconfigured genre blocklist lets through clearly unsuitable content | Low | High | Medium | Blocklist is managed by the admin in the panel, cascades with genres, and is visible in one place; ladder is the second independent control | Low-Medium |

**Conclusion (children's processing).** The household children's processing is
not likely to result in a high risk to rights and freedoms after the
mitigations above. If the feature is promoted to the production demo, this
conclusion must be re-derived with an Art. 8 analysis and an AADC review
before any child is let in; Art. 36 prior consultation applies only if a high
residual risk remains after those measures.

---

## Cross-reference

- `docs/roa.md` — Activities 1–2 (profiles/auth), 9–11 (enrichment, AI, Supabase), 12 (kids accounts)
- `docs/gdpr-governance.md` — lawful-basis register, data-protection lead
- `docs/retention.md` — retention schedule (#14–16 kids accounts)
- `docs/processors.md` — processor inventory
- `docs/breach-procedure.md` — Art. 33–34 procedure
- `decisions/033-kids-accounts-age-ladder.md` — kids accounts decision
- `specs/38-child-accounts.md` — kids accounts spec
- `decisions/014-webview-http-scheme.md` — Android transport decision
- `LIMITATIONS.md` §2.0, §4 — offline gap; Android TLS security debt
