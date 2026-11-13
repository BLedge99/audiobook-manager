# Android native OAuth — implementation plan

Status: proposal, 2026-11-11. Nothing here is built yet. This document is the
route from "the buttons navigate to `https://localhost/api/auth/google/authorize`
and reload the shell" to "Sign in with Google/GitHub works on the Android app,
RFC 8252 compliant".

**Non-goals:** the web flow, the email/password flow, the household-password
flow, passkeys, and the admin panel are all unchanged. The feature is inert
until `OAUTH_*` env is configured, exactly as the web OAuth buttons are.

## Why the buttons do nothing today (measured, not theorised)

1. `AccountGate.startOAuth` does `window.location.href = '/api/auth/google/authorize'`
   — a *root-relative* URL. In the browser that hits the production site. In
   the Android WebView the origin is `https://localhost` (the bundled app), so
   it asks the asset loader for something that doesn't exist and the shell
   reloads: the "connecting logo, then back to sign-in" symptom. The demo-mode
   anchors (`<a href="/api/auth/...">`) have the same defect.
2. Even pointed at the right origin, Google **refuses to render its consent
   page inside an embedded user-agent** (`403 disallowed_useragent`), and it
   has since 2021 (see "Research" below). GitHub renders, but the round trip
   ends on the production web app inside the WebView, setting a
   `SameSite=Lax` cookie on the server origin that the native client
   deliberately never reads (native clients carry an in-memory `x-house-session`
   header instead) — so it would flash through and sign nobody in.
3. Spec 32 explicitly scoped OAuth to the web demo: "Android | Out of scope —
   web-only" ([specs/32-oauth-email-signin.md](../specs/32-oauth-email-signin.md)
   line 31, line 131) and LIMITATIONS.md repeats it ("Android untouched").
   This plan lifts that scope, properly.

## The shape of the fix (decision record 030, written in Phase 0)

RFC 8252 (OAuth 2.0 for native apps) mandates an **external user-agent** for
native authorization requests. On Android that means **Chrome Custom Tabs**
(recommended "in-app browser tab pattern"; SSO-capable, user sees the normal
browser consent page) reached via `@capacitor/browser`, with the response
delivered to the app through a **private-use URI scheme** handled by
`@capacitor/app`'s `appUrlOpen` event. We will NOT use an embedded WebView, and
we will NOT pretend the WebView flow "mostly works".

### The flow, end to end

```
Android app (https://localhost)                Custom Tab (prod server)         Google/GitHub
        |  1. Browser.open(                     |                                |
        |     GET {serverUrl}/api/auth/          |                                |
        |     google/authorize                   |                                |
        |       ?client=native&state=<128-bit>)  |                                |
        |--------------------------------------->|  2. sets oauth_state,          |
        |                                        |     oauth_code_verifier        |
        |                                        |     (HttpOnly), 302 ---------> |
        |                                        |                                |  3. consent
        |                                        |  4. 302 -> server callback     |
        |                                        |<-------------------------------|
        |                                        |  5. validate state/PKCE,       |
        |                                        |     signInWithOAuth (as today) |
        |                                        |  6. INSERT OAuthHandoff        |
        |                                        |     (codeHash, stateHash,      |
        |                                        |      profileId)                |
        |  7. 302 -> com.technative.audiobookmanager://oauth/callback             |
        |     ?code=<one-time-code>&state=<128-bit>                            |
        |<---------------------------------------|                                |
        |  8. appUrlOpen: scheme/host/path match,                               |
        |     state == in-flight state?  else show error, no API call           |
        |  9. Browser.close()                                                   |
        | 10. POST {serverUrl}/api/auth/oauth/handoff                           |
        |     { code, state } -----------------> |  11. sha256(state) match row,  |
        |                                        |      sha256(code) match,       |
        |                                        |      !consumed, expiresAt>now; |
        |                                        |      atomically consume row;   |
        |                                        |      mint session (same call   |
        |                                        |      password sign-in uses)    |
        | 12. { token, profileId } ------------- |                                |
        | 13. setSessionToken(token); fetchSession(); same finish path as       |
        |     email/password sign-in (x-house-session header)                   |
```

### Why the one-time handoff code exists

RFC 8252 §8.1: a private-use scheme can be claimed by any installed app, so the
deep link may be delivered to the wrong process. The handoff code is therefore:

- **single-use** (atomically consumed; a re-play fails with `oauth_handoff_invalid`),
- **short-lived** (60 s TTL; a startup sweep deletes expired rows),
- **state-bound** (the app verifies the returned `state` equals the one it
  generated — RFC 8252 §8.9 cross-app request forgery protection — and the
  server independently re-verifies `sha256(state)` before releasing the token),
- **hashed at rest** (`sha256` of both code and state; plaintext exists only in
  the deep link and the exchange request),
- carries **no profile PII beyond the pseudonymous `profileId`** needed to
  finish sign-in, and nothing else.

The provider leg keeps today's server-side PKCE S256 + HttpOnly `oauth_state` /
`oauth_code_verifier` cookies, untouched. No provider client re-registration:
`redirect_uri` stays `{origin}/api/auth/{provider}/callback`.

### Rejected alternatives (ADR 036 content)

- **Embedded WebView flow** — blocked by Google since 2021
  (`disallowed_useragent`); GitHub proceeds but cannot seed the native session.
  Google Play policy exposure. Prohibited by RFC 8252 §8.12.
- **Passing the session token straight in the deep link** — lands in intent
  URLs, logs and app switchers, replayable. The one-time secret-bound code is
  the same threat class but single-use and 60 s.
- **HTTPS App Links** (`autoVerify`, `.well-known/assetlinks.json`) — RFC 8252
  §7.2, mechanically stronger (OS-verified domain), but requires the server to
  present a **valid TLS certificate for a domain we control** — true for the
  production demo host, impossible for a plain-HTTP LAN household server with a
  DHCP address. Kept as a documented follow-up (Phase 6) for the demo host only.
  The custom scheme works everywhere the app runs.
- **Loopback redirect** — RFC 8252 §7.3; pointless on a phone with a working
  browser hand-off.

## Data model (additive, both Prisma schemas)

```prisma
/// Single-use handle for handing an OAuth identity to the Android shell after
/// the system-browser round trip (ADR 036 / spec 32 native flow). Carries no
/// token at rest: the session is minted at exchange time, once the caller
/// proves it holds the one-time code and the matching app-generated state.
/// Plaintext exists only inside the deep link and the exchange request;
/// everything at rest is sha256.
model OAuthHandoff {
  id          String    @id @default(uuid())
  codeHash    String    @unique  // sha256(handoff code)
  stateHash   String              // sha256(app-generated state)
  profileId   Int                 // the resolved account; OAuth always resolves to one
  expiresAt   DateTime            // created + 60s
  consumedAt  DateTime?
  createdAt   DateTime  @default(now())
}
```

The session table stores tokens as `sha256` hashes ([`server/src/auth/session.ts`](../server/src/auth/session.ts) `hashSessionToken`), so minting it at exchange time keeps this row free of anything token-shaped: no token ever needs to exist at rest in a second place. The handoff row holds only a pseudonymous `profileId`, lives for at most 60 s plus the startup sweep, and points to no user content. GDPR: lawful basis Art. 6(1)(b) (contract — providing sign-in), retention = 60 s TTL + startup sweep; no DSR impact beyond the session record itself. Documented in `docs/roa.md` + `docs/retention.md`.

## Phases (strict TDD: red → implement → green → commit/push at each checkpoint)

### Phase 0 — Specification and decision (no runtime code)
Files: new ADR (`decisions/036-android-native-oauth.md`), extended
`specs/32-oauth-email-signin.md` (new "Native flow" section; lift the "Android:
out of scope" lines), `docs/roa.md`, `docs/retention.md`, `LIMITATIONS.md` row.

1. Extend spec 32 with the native contract: deep-link shape, single-use/TTL/
   state rules, error codes (`auth_error` arrives in the deep link, app renders
   the matching reviewed sentence), and the acceptance criteria below.
2. Write ADR 036 capturing the decision, rejected alternatives, and threats.
3. GDPR delta entries (lawful basis, retention, DSR) in the two docs above.
4. Verification checklist for spec 32 + this file copied into the spec's own
   checklist. **Commit + push.**

Acceptance criteria the spec gains (each maps to tests unless marked manual):

- A1. Custom-Tab round trip signs the Android app in with a Google account,
  same account resolution as the web (manual device check; see Phase 5).
- A2. Same for GitHub (manual device check).
- A3. Cancel in the provider returns to the sign-in screen with the
  reviewed `oauthFailed` sentence, not a hung or blank screen.
- A4. Deep-link with a state that doesn't match the in-flight flow: error
  shown, zero API calls made, token untouched (unit).
- A5. Re-using a consumed handoff code: 401 `oauth_handoff_invalid` (unit). Session
  is minted at exchange time, so A5's success case also proves the following call
  to `/api/auth/session` returns the signed-in session.
- A6. Expired handoff (61 s): 401 (unit, fake timers).
- A7. Handoff endpoint rate-limited like the other auth endpoints (unit).
- A8. Web flow identical to before (regression tests green, no cookie changes).
- A9. Household deployment without `OAUTH_*` env: OAuth buttons absent,
  zero behaviour change (unit).

### Phase 1 — Server: handoff model + exchange endpoint (red first)
Files: `server/prisma/sqlite/schema.prisma`, `server/prisma/postgres/schema.prisma`,
additive migrations for both, `server/src/auth/service.ts` (or a new
`server/src/auth/handoff.ts` mirroring the codebase's auth module layout),
`server/src/auth/routes.ts` (new `POST /api/auth/oauth/handoff` with a Fastify
schema), `server/src/index.ts` (startup sweep for expired rows, next to the
existing `cleanupExpired` call).

Tests written first, run red, then implemented:

- Exchange rejects missing body/fields with 400 (schema validation only).
- Unknown / malformed code → 401 `oauth_handoff_invalid`.
- Code older than TTL → 401 (inject clock; the codebase has an `opts.now`
  pattern in `AuthService` already — `auth.service.test.ts` uses it, follow it).
- Committed-consume: first exchange succeeds `{ token, profileId }`; second
  with same code → 401; wrong `state` → 400; `state` is `sha256`-checked.
- Handoff rows are unrecoverable-after-consume in SQL terms (no plaintext code
  column exists anywhere).
- Startup sweep deletes expired unconsumed rows.
- Migration applies cleanly to a scratch SQLite file (both schema paths).

**Commit + push.**

### Phase 2 — Server: native branch in authorize/callback (red first)
Files: `server/src/auth/routes.ts` (query-string validation on
`/api/auth/:provider/authorize` — `client` enum `web|native` default `web`,
`state` string 1–128 printable, 400 otherwise), new cookie
`oauth_app_state` (HttpOnly, SameSite=Lax, path `/`, 10-minute TTL) written
only when `client=native`; `callback` reads it.

Tests written first:

- `?client=native&state=abc` → provider redirect as today; sets `oauth_app_state=abc`;
  no handoff row yet.
- `?client=bogus` → 400. Oversized `state` → 400.
- callback with native cookies present → 302 to
  `com.technative.audiobookmanager://oauth/callback?code=<…>&state=abc`;
  `house_session` **not** set; a handoff row exists matching the code/state hashes.
- callback in native mode with an auth failure → 302 to the deep link with
  `auth_error=<code>` (so the app can render the web's exact error copy);
  cookies cleared as today.
- callback **without** native cookies → byte-identical behaviour to today
  (existing suite passes unmodified — regression anchor).
- authorize → callback happy path with client=web stays untouched.

**Commit + push.**

### Phase 3 — Android shell plumbing
Files: `client/package.json` (`@capacitor/app`, `@capacitor/browser` — both
bring their own native code), `client/android/app/src/main/AndroidManifest.xml`
(one additional inner `<intent-filter>` on `MainActivity` — file already
`launchMode=singleTask`, which is what we want for a single running instance),
`capacitor.config.ts` (unchanged), run `npx cap sync android`. House rule:
`npm audit` clean before finishing the dependency change. No client code yet.

```xml
<intent-filter>
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="com.technative.audiobookmanager" android:host="oauth" />
</intent-filter>
```

Verify: `.\scripts\install-android.ps1` assembles and installs; cold `am start com.technative.audiobookmanager/.MainActivity -a android.intent.action.VIEW -d "com.technative.audiobookmanager://oauth/callback?code=test&state=x"` logs the intent filter match (logcat) — **manifest check only, not a feature run**. **Commit + push.**

### Phase 4 — Client: native path (red first)
Files: `client/src/lib/oauthNative.ts` (new): `beginNativeOAuth(provider)`
generates `state`, opens `{serverUrl}/api/auth/{provider}/authorize?client=native&state=…`
via `Browser.open`, stores the in-flight `{ provider, state }` in module
memory (never persisted — a stale pending flow must die with the process);
`handleOAuthDeepLink(url)` pure-ish function: scheme/host/path match → state
match or typed failure → POST handoff → returns `{ token, profileId }`;
`auth_error` in the URL maps to the existing `copy.login.oauth*` sentences.
`AccountGate.tsx`: native shell → button calls `beginNativeOAuth`; web shell →
unchanged `window.location.href` (with **absolute** URL via `apiUrl(...)` so the
root-relative bug is gone everywhere — that's the standing bug from Phase-0
diagnosis, fixed as a ride-along with regression tests either way).
`App.tsx` (or a small `OAuthDeepLinkListener` component at the root, matching
the codebase's component patterns): on mount, `App.getLaunchUrl()` (cold start)
plus `App.addListener('appUrlOpen', …)` → `handleOAuthDeepLink` →
`setSessionToken` + the same finish sequence the password path uses for native
shell (`isNativeShell()` branch already exists in `api.ts: finish` flow via
`SessionSettings`/biometric code — extract the shared settle-in logic if it
already exists, otherwise fold into the listener with unit tests) →
`fetchSession()` → UI lands signed-in. `Browser.close()` on receipt.

Tests written first (vitest + Testing Library, plugins mocked with
`vi.mock('@capacitor/browser', …)` / `vi.mock('@capacitor/app', …)`):

- Native button click does not touch `window.location.href`; it calls
  `Browser.open` with `{ url }` where URL is absolute and contains
  `client=native` + a 128-bit `state` (decode and assert).
- Web button click still navigates (regression).
- `handleOAuthDeepLink`: happy path returns token; state mismatch → throws
  `OAuthNativeError('oauth_state_mismatch')`, no fetch issued; wrong scheme →
  no-op; `auth_error=oauth_email_not_verified` → maps to the right sentence.
- Listener test: matching deep link → `POST .../handoff` happens, session token
  stored, `fetchSession` called (mock fetch), sign-in UI replaced.
- `AccountGate` sign-in list shows no OAuth buttons when `/api/config` returns
  no `oauthProviders` (unchanged behaviour, asserted).

**Commit + push.**

### Phase 5 — Verification and docs (no new features)
1. `make test-server`, `make test-client`, `make check-copy`, both Prisma
   schema validations on fresh scratch DBs. `npm audit` both trees.
2. Manual device matrix (this device, via `adb`): prod-demo Google round trip;
   prod-demo GitHub round trip; provider-cancel path; wrong-scheme deep link
   (`am start -d "com.evil.app://oauth/callback?code=x"`) ignored; tampered
   `state` deep link → error text, no token; kill app during consent; relaunch →
   handoff consumed exactly once; household server (no `OAUTH_*`) → buttons
   absent.
3. `LIMITATIONS.md` spec-32 row → native OAuth implemented (refs ADR 036,
   spec 32); `GDPR-AUDIT.md` auth file list if it enumerates auth files;
   `README_technical.md` Android row; spec 32 checklist ticks. **Commit + push.**

### Phase 6 — (optional, documented, not committed unless chosen)
HTTPS App Links for the **production demo host only**: `assetlinks.json` served
from the prod server's `.well-known`, an `autoVerify` intent filter for
`https://<demo-host>/oauth/callback`, deep-link delivery without a custom scheme
(RFC 8252 §7.2). Household LANs never qualify; this changes nothing for them.
If taken as a follow-up it is its own ADR + spec edit, referencing ADR 036.

## Testing doctrine (as requested: tests before code, run red first)

Every phase follows one loop:
1. Write the failing test(s) for exactly the behaviour listed.
2. Run and observe red (`npm run test -- <file>` in `server/`, `client/`).
3. Implement the least code to pass.
4. Re-run red list green; run the whole suite for the tier; `make check-copy`.
5. Commit with a message referencing the spec (`spec 32`), push.
No phase merges on red. No production code before its test exists. The
regression anchors — spec 29 offline behaviour, spec 28 account handling,
spec 02 test infra — are not weakened or re-baselined to make green.

## Risks and explicit decisions taken up front

| Risk | Mitigation |
|---|---|
| Deep-link code intercepted by a malicious app | Single-use + 60 s TTL + app-side and server-side state verification (RFC 8252 §8.1/§8.9); no token in the URL; plaintext never stored |
| Cold start race (`appUrlOpen` before listener is ready) | Phase 4 handles both `getLaunchUrl()` (returning-from-kill) and `addListener` (warm path); covered by tests |
| Custom-Tab back-stack residue | `Browser.close()` immediately on receipt; tested in the device matrix, not in unit tests (honest about that split) |
| OAuth misconfigured in prod (button shipped broken) | Existing `/api/config` gate already hides buttons; Phase 5 desktop-browser regression check proves round trip end to end |
| Additive migration drifts sqlite/postgres | Both schemas edited in the same commit; both validated in Phase 5 |
| Handoff row holds a pseudonymous `profileId` | 60 s TTL + startup sweep; an id alone reveals nothing and resolves nothing without the session |
| Demo (public, Google-reviewed) vs household (no OAuth) | Identical feature flag (`oauth.enabled`); household unaffected and unverifiable-by-OAuth by construction |

## Research references (2026-11-11)

- RFC 8252 — OAuth 2.0 for Native Apps: external user-agent required (§6);
  private-use URI scheme redirect rules + reverse-domain requirement (§7.1);
  in-app browser tabs recommended (§6); PKCE mandatory for public native
  clients (§6, §8.1); cross-app request forgery → high-entropy `state`,
  verified (§8.9); mix-up → unique redirect URI per authorization server (§8.10);
  embedded user-agents prohibited (§8.12).
- RFC 8252 Appendix B.2 — Android: Custom Tabs for the auth request,
  private-use scheme or claimed HTTPS for delivery, implicit intents.
- Capacitor docs — Deep Links (`App.addListener('appUrlOpen')`,
  `App.getLaunchUrl()`); `@capacitor/browser` (`Browser.open` → Custom Tab).
- Google — "Embedded webview libraries are blocked starting 2021"
  (Google Developers Blog, June 2021); `disallowed_useragent`; Play Console
  flags WebView authentication usage (Remediation for OAuth via WebView,
  support.google.com/faqs/answer/12284343).
- This repo — `client/src/components/AccountGate.tsx` (`startOAuth`, the finish
  path), `client/src/lib/api.ts` (native session-token model), 
  `server/src/auth/routes.ts` (authorize/callback incl. server-side PKCE and
  `oauth_state` cookies — stays server-side untouched), `specs/32`, ADR 023.

## Suggested spec/ADR numbering

- `decisions/036-android-native-oauth.md`
- Spec 32 extended in place (not a new spec) — the feature *is* the OAuth spec,
  extended to its last un-shipped platform.
