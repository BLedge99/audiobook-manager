# Data Protection Impact Assessment (DPIA) — Production Demo — GDPR Art. 35

**Last updated:** 5 November 2026  
**Status:** Draft — implements Phase 8 of `docs/GDPR-REMEDIATION-PLAN.md`  
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
| **Recipients** | No third party receives personal data. Enrichment queries (Open Library, LibriVox, Audnexus, optional Google Books) send book identifiers only. Optional LM Studio runs locally. Optional Supabase Storage stores audiobook files only (private bucket, server-side). |
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

---

## Cross-reference

- `docs/roa.md` — Activities 1–2 (profiles/auth), 9–11 (enrichment, AI, Supabase)
- `docs/gdpr-governance.md` — lawful-basis register, data-protection lead
- `docs/retention.md` — retention schedule
- `docs/processors.md` — processor inventory
- `docs/breach-procedure.md` — Art. 33–34 procedure
- `decisions/014-webview-http-scheme.md` — Android transport decision
- `LIMITATIONS.md` §4 — Android TLS security debt
