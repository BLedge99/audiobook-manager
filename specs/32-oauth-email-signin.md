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
| Android | Out of scope for this spec's release; demo is web-only |

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
```

## API

- `GET /api/auth/:provider/authorize`
- `GET /api/auth/:provider/callback`
- Email + password sign-in / minimal sign-up routes (existing password surface
  extended).

Public (no session): the authorize/callback routes must be added to
`isPublicApiPath` and pass the auth gate.

## Error codes

New codes: `oauth_state_mismatch`, `oauth_code_exchange_failed`,
`oauth_email_not_verified` (Google), `oauth_account_disabled`, and reuse of the
existing `account_disabled`, `auth_required`, `incorrect_password` as
appropriate. Sentences live in `client/src/copy.ts`; unknown codes degrade to the
generic sentence.

## Security rules

- PKCE on the authorization request; single-use `state`.
- Server-side token exchange; no client-secret exposure to the browser.
- OIDC claim validation: `iss`, `aud`, `exp`, `nonce`, `email_verified`.
- Redirect URI allowlist; provider-credential validation.
- Rate limits on authorize/callback paths.

## Acceptance criteria

- [x] Production can start an OAuth flow for Google and GitHub with PKCE + state.
- [x] Callback validates state and exchanges/validates correctly (mocked IdP in tests).
- [x] New OAuth identity creates a member profile and signs in.
- [ ] Verified email resolves to an existing profile. (Partially: email resolution
      by verified identity exists; verification itself is deferred.)
- [x] Email + password sign-in works with minimal account creation.
- [x] Local environments remain gated off.
- [x] Static client assets and SPA fallback stay public; callback passes the gate.

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

- Email verification and password reset end-to-end (deferred).
- Android OAuth / native sign-in (out of scope for this release).
- Offline for passwordless accounts (not needed for the online demo).
- Full OIDC client with provider discovery (deferred).
- SSO / LDAP / enterprise IdP.
