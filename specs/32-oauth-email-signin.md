# Spec 32 — Production external sign-in (OAuth and email/password)

## Purpose

The production deployment runs as a **demo household**: real people sign in over
the web (`https://books.home.arpa`) to use a limited set of free LibriVox books
and see how the app works.

Until now that audience had no account surface: the household password is not a
stranger's password, and the profile picker expects profiles created by the
household admin. This spec adds the production external sign-in surface:

- **Google** and **GitHub** OAuth sign-in;
- **email + password** sign-in, with minimal account-creation wiring;
- local environments keep the admin-managed household model (the feature is
  gated off outside production).

The architectural content is [`decisions/023-oauth-email-signin-production-demo.md`](../decisions/023-oauth-email-signin-production-demo.md).

## Status (2026-11-04)

**Implemented 2026-11-04** (phase plan: docs → server → client → ops → tests,
all but the live IdP verification now landed):

| Area | Status |
|---|---|
| Demo-household semantics (sign-ups join as member profiles; demo content is the hosted library) | Accepted; shipped |
| Providers (Google + GitHub) | Accepted; shipped (PKCE + server state + token exchange + identity validation) |
| Email/password sign-in wiring | Accepted (verification and reset deferred); minimal wiring shipped, end-to-end deferred |
| Offline | Not needed for the online demo; passwordless accounts stay passwordless |
| Android | Native (Android) flow specified 2026-11-11 (ADR 030; plan: [`docs/android-native-oauth-plan.md`](../docs/android-native-oauth-plan.md)); implementation in progress. Web remains the reference audience |

The phases landed in order: docs (ADR 023, this spec, roadmap, LIMITATIONS),
server foundation (schema delta, service, routes, errors, gate, sessions,
rate limit), client (provider buttons, email mode, copy, error mapping), ops
(env + compose + provider-console checklist). Remaining before go-live: the
real Google/GitHub IdP verification checklist (see Testing).

## Behaviour

### External (OAuth) sign-in

- `GET /api/auth/:provider/authorize` starts the flow; the client is redirected
  to the provider with `response_type=code`, PKCE and `state`.
- `GET /api/auth/:provider/callback` validates `state`, exchanges the code
  server-side, validates the identity (OIDC claims for Google; access token +
  user API for GitHub) and answers with a session for the resolved profile.
- A brand-new identity creates a new member `Profile`; a known verified email
  resolves to an existing profile.
- The web client lands in the app; for a new profile, sign-up drops the user into
  the app without extra profile-creation steps (minimal UI).

### Email + password

- Email/password sign-in and minimal account creation are wired; verification
  and reset flows are deferred (tracked here, not built).

### Local environments

- Gated off. Local keeps the admin/household password model.

## Native (Android) flow

Spec extension 2026-11-11 (ADR [`decisions/030-android-native-oauth.md`](../decisions/030-android-native-oauth.md); phased plan in [`docs/android-native-oauth-plan.md`](../docs/android-native-oauth-plan.md)). The Android app cannot use the in-WebView redirect flow: Google blocks embedded user-agents outright (`disallowed_useragent`), and the native client never reads the cross-site session cookie by design. RFC 8252 mandates an external user-agent, so the native flow reuses the existing provider leg and adds a one-time, state-bound handoff back into the app:

1. The app opens **Chrome Custom Tabs** at `{serverUrl}/api/auth/:provider/authorize?client=native&state=<app-generated random state>` via `@capacitor/browser`. (`client=web` is the default; anything else → 400.)
2. The server keeps today's PKCE + HttpOnly `oauth_state`/`oauth_code_verifier` as-is, plus a short-lived `oauth_app_state` cookie memorising the app-generated `state`. **Nothing else changes for the provider leg.**
3. On callback the server validates state/PKCE and resolves the account exactly as the web flow does. In native mode it does **not** set `house_session`; instead it inserts one `OAuthHandoff` row — sha256 of a fresh 128-bit one-time code, sha256 of the app state, the resolved `profileId`, 60-second TTL — and 302s to `com.technative.audiobookmanager://oauth/callback?code=<code>&state=<state>` (or `...?auth_error=<code>` on failure).
4. The app (`@capacitor/app`, `appUrlOpen` / `getLaunchUrl()`) verifies scheme/host/path and that `state` equals the in-flight flow it started; anything else shows the generic failure sentence and makes **zero API calls**. It then closes the Custom Tab and calls `POST /api/auth/oauth/handoff` with `{ code, state }`.
5. The handoff endpoint schema-validates the body, sha256-checks state and code, requires the row unconsumed and unexpired, atomically marks it consumed, then **mints the session at exchange time** (same call the password sign-in uses) and answers `{ token, profileId }` — the same body shape as the password login. The app stores the token in memory and proceeds exactly as after a password sign-in (`x-house-session` header, `/api/auth/session` bootstrap). Any failure → `401 oauth_handoff_invalid` (state mismatch → `400`); rate-limited like the other auth endpoints.

Properties: no token is ever placed in a URL or stored at rest before consumption; the one-time code is single-use and expires in 60 s (consumed atomically, expired rows swept at startup); the `state` binds the deep link to the in-flight flow (app-verified, RFC 8252 §8.9) and is re-verified server-side; the household deployment without `OAUTH_*` env is unaffected by construction. The website and the WebView remain the supported runtime for OAuth on the web; Android never ships an embedded-UA path.

Errors: native auth failures redirect to the deep link with `auth_error=<code>` and the app renders the same reviewed sentence as the web (`copy.login.oauth*`). New error code: `oauth_handoff_invalid`.

## Data model

Additive. `Profile` gains nullable OAuth identity columns and an email field;
no column is removed or repurposed.

```prisma
model Profile {
  // existing fields...
  oauthProvider   String?  // "google" | "github" | null
  oauthProviderId String?
  email          String?
}

// Native flow (ADR 030), additive:
model OAuthHandoff {
  id          String    @id @default(uuid())
  codeHash    String    @unique  // sha256(handoff code)
  stateHash   String              // sha256(app state)
  profileId   Int                 // resolved account; always one for OAuth
  expiresAt   DateTime            // created + 60s
  consumedAt  DateTime?
  createdAt   DateTime  @default(now())
}
```

## API

- `GET /api/auth/:provider/authorize` — web flow by default; with
  `?client=native&state=<128-bit>` starts the native flow (native cookies; the
  provider leg itself is unchanged). `client` must be `web` (default) or `native`,
  otherwise 400.
- `GET /api/auth/:provider/callback` — unchanged from the browser's point of view;
  in native mode answers with a deep link instead of a session cookie.
- `POST /api/auth/oauth/handoff` — **new**, public; body `{ code, state }`
  (schema-validated); consumes a handoff row and returns `{ token, profileId }`.
- Email + password sign-in / minimal sign-up routes (existing password surface
  extended).

Public (no session): the authorize/callback routes must be added to
`isPublicApiPath` and pass the auth gate.

## Error codes

New codes: `oauth_state_mismatch`, `oauth_code_exchange_failed`,
`oauth_email_not_verified` (Google), `oauth_account_disabled`,
`oauth_handoff_invalid` (native exchange: unknown/expired/consumed/code
problems; `state` mismatch at the exchange route itself is a 400), and reuse of
the
existing `account_disabled`, `auth_required`, `incorrect_password` as
appropriate. Sentences live in `client/src/copy.ts`; unknown codes degrade to the
generic sentence.

## Security rules

- PKCE on the authorization request; single-use `state`.
- Server-side token exchange; no client-secret exposure to the browser.
- OIDC claim validation: `iss`, `aud`, `exp`, `nonce`, `email_verified`.
- Redirect URI allowlist; provider-credential validation.
- Rate limits on authorize/callback paths; rate limit on the handoff exchange.
- Native flow: one-time, 60-second, state-bound handoff codes; sha256 at rest;
  session minted only at exchange time; app-verified `state` (RFC 8252 §8.9)
  re-verified server-side; zero embedded-user-agent usage.

## Acceptance criteria

- [x] Production can start an OAuth flow for Google and GitHub with PKCE + state.
- [x] Callback validates state and exchanges/validates correctly (mocked IdP in tests).
- [x] New OAuth identity creates a member profile and signs in.
- [ ] Verified email resolves to an existing profile. (Partially: email resolution
      by verified identity exists; verification itself is deferred.)
- [x] Email + password sign-in works with minimal account creation.
- [x] Local environments remain gated off.
- [x] Static client assets and SPA fallback stay public; callback passes the gate.
- [ ] A1. Android: Custom-Tab round trip signs in with Google (manual device check, Phase 5).
- [ ] A2. Android: Custom-Tab round trip signs in with GitHub (manual device check, Phase 5).
- [ ] A3. Android: cancelling in the provider returns to sign-in with the reviewed sentence.
- [ ] A4. Android: deep link with a `state` mismatch — error shown, zero API calls, no token.
- [x] A5. Native handoff: re-using a consumed code → `401 oauth_handoff_invalid`; success case signs in via the native token path (unit).
- [x] A6. Native handoff: code older than the 60-second TTL → 401 (unit, injected clock).
- [x] A7. Native handoff endpoint is rate-limited like the other auth routes (unit).
- [x] A8. Web flow unchanged: existing OAuth route tests green with no cookie changes.
- [x] A9. Household deployment without `OAUTH_*` env: no OAuth surface, zero behaviour change (unit).

## Testing

- [x] Server unit + Fastify `inject` route tests with mocked IdP/token exchange.
- [x] Client unit tests for new copy/error mapping/actions.
- [ ] Real IdP flows: manual/ops checklist (Google Cloud console client, GitHub OAuth
      app, redirect URIs, CA trust at `books.home.arpa`) — pending go-live.

## Phases

1. Docs (this spec, ADR 023, roadmap, limitations).
2. Server foundation: schema delta, service, routes, errors, gate, sessions.
3. Client: provider buttons, email/password surface, copy, error mapping.
4. Ops: env, compose, provider-console docs.
5. Tests + hardening.

## Not in this spec

- Native Android sign-in is specified here ("Native (Android) flow"); implementation tracks docs/android-native-oauth-plan.md phases 1–5.
- Email verification and password reset end-to-end (deferred).
- Offline for passwordless accounts (not needed for the online demo).
- Full OIDC client with provider discovery (deferred).
- SSO / LDAP / enterprise IdP.
