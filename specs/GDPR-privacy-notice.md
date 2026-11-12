# Spec: GDPR Privacy Notice & Transparency

**Status:** Implemented — implements GDPR remediation Phase 2  
**GDPR basis:** Art. 12–14 (transparent information, communication, modalities)

---

## 1. Purpose

Publish a privacy notice so users (household members and production-demo visitors) know what personal data is collected, why, on what legal basis, who receives it, how long it is kept, and what rights they have. The notice must be reachable without authentication and linked before any personal data is collected.

---

## 2. Server route: GET /privacy

**Auth:** None — publicly accessible without a session.

**Content:** HTML privacy notice covering:

- **Who we are** — controller identity (household admin or demo operator), contact point
- **Why we collect your data** — purposes (identity/sign-in, listening history, favourites, wishlist, library membership, device credentials)
- **Legal basis** — contract (Art. 6(1)(b)), legitimate interest (Art. 6(1)(f)), consent (Art. 6(1)(a))
- **What data we collect** — profile data, session metadata, listening history, favourites, wishlist, library entries, WebAuthn credentials, email (demo mode), age band (kids accounts, spec 38)
- **Who receives your data** — no third parties receive personal data; enrichment queries send book identifiers only
- **How long we keep it** — per `docs/retention.md`
- **Your rights** — export, erasure, rectification, objection, restriction, complaint
- **Cookies** — one strictly necessary session cookie; no analytics or tracking
- **No profiling** — tag-similarity recommendations are not automated decisions under Art. 22
- **International transfers** — no personal data transferred
- **Complaints** — supervisory authority (Art. 77(d))
- **Children's accounts** (spec 38) — children are managed by a household adult; they see only age-appropriate books, keep the same Art. 15–17 rights, and are not profiled

**Errors:** None — always returns `200` with `text/html; charset=utf-8`.

---

## 3. Client copy

Privacy-notice strings live in `client/src/copy.ts` under `copy.privacy`:

- `link` — "Privacy notice" (link text)
- `linkHint` — "How we handle your personal data."
- `demoIntro` — short line near sign-up/account creation in demo mode
- `heading`, `controller`, `purposes`, `lawfulBasis`, `dataCategories`, `recipients`, `retention`, `yourRights`, `cookies`, `complaints`, `noProfiling`, `noAnalytics`, `thirdPartyNone`, `contact`, `export`, `erase`

---

## 4. Links

The privacy notice is linked from:

- Sign-in screen (`AccountGate.tsx`) — before credentials are entered
- Account menu (`AccountMenu.tsx`) — alongside export and delete options

No personal data is collected before the notice is linked.

---

## 5. Cookie disclosure

- One session cookie (`house_session`): HttpOnly, Secure (over HTTPS), SameSite
- Strictly necessary to keep the user signed in — does not require consent
- No analytics or tracking cookies, no beacons, no advertising IDs, no third-party trackers

---

## 6. Acceptance criteria

- [x] `GET /privacy` returns `200` with HTML content (no session required)
- [x] Notice covers both household and production-demo modes
- [x] Notice is linked from the sign-in screen before credential entry
- [x] Notice is linked from the account menu
- [x] Cookie section discloses the session cookie as strictly necessary
- [x] No analytics or tracking cookies are disclosed as present (because none exist)
- [x] `copy.privacy` strings exist and are used by client components
- [x] Client copy test passes (`make check-copy`)

---

## 7. Tests

- Route test: `GET /privacy` returns `200` with notice content
- Client copy test for privacy-notice strings
