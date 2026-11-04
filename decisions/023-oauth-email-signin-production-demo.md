# ADR 023 — External sign-in for the production demo: Google/GitHub OAuth, email/password

## Status

Accepted 2026-11-04. Follows ADR 016 (profiles are accounts), ADR 019 (PostgreSQL
production, SQLite local) and ADR 006 (remote access deferred). Updates the
"not in this spec" line of
[`specs/28-accounts-passkeys-biometrics.md`](../specs/28-accounts-passkeys-biometrics.md)
by adding an external-identity surface to the **production deployment**; the
household-local threat model and the offline rules of ADR 016 are unchanged.

Spec: [`specs/32-oauth-email-signin.md`](../specs/32-oauth-email-signin.md).

## Context

The household product deliberately deferred full identity-provider sign-in
(spec 28, "Not in this spec": *"A full identity provider, OAuth, LDAP or SSO. This
is a household, not an organisation."*). ADR 016 settled the account model: a
`Profile` is the account, there is no second user table, and access is a
password / passkey / device ceremony against that profile.

The production server (`books.home.arpa`, Caddy TLS) now hosts a **demo
audience**: real people sign in over the web to look at a limited set of free
LibriVox books and see how the app works. Against that audience the existing
surfaces are the wrong tool or no tool at all:

- the household password is meaningless to a stranger who found the site;
- the profile picker assumes profiles that are created by the household admin;
- there is no way for a person to *become* a profile.

The feature request (2026-11-04) is therefore: let production users make an
account and sign in with email, Google or GitHub — while local environments
keep the admin-managed household model.

## Decision

1. **The profile remains the account.** External sign-in resolves to a
   `Profile` (creating a new member profile for an unknown identity) or links to
   one by verified email. No separate user/identity table is introduced; the
   nullable OAuth columns ride on `Profile`, additive only.

2. **OAuth uses the Authorization Code flow with PKCE**, token exchange on the
   server, `state` validation, and OIDC claim checks (`iss`, `aud`, `exp`, `nonce`,
   `email_verified`) for Google; GitHub is consumed via access token + user API.

3. **First release ships Google + GitHub.** Email/password sign-in gets minimal
   wiring (sign-in + account creation); email verification and password reset are
   deferred.

4. **The production deployment is a demo household.** Sign-ups join as member
   profiles; the demo content is the hosted library. Passwordless accounts stay
   passwordless (offline not needed for online demos). Android is out of scope for
   this release; the demo is web-only for now.

## Alternatives considered

- **Full OIDC client library with discovery** (e.g. an OpenID Connect client
  package) instead of hand-rolled authorize/callback + exchange. Deferred: the
  two providers' endpoint shapes are stable enough for a first release, and the
  bespoke route keeps the auth gate, cookie and session semantics in one place.
- **A separate identity/provider-link table** rather than columns on `Profile`.
  Rejected for now: ADR 016 already drew the line against a second user-shaped
  table; a narrow link table is revisitable later, but the columns keep this
  additive and small.
- **SSO / LDAP / enterprise IdP.** Out of scope; not requested and not useful for
  a household demo.
- **Password required for OAuth accounts.** Rejected for this release: the demo
  audience has no reason to hold a password, and offline is explicitly out of
  scope for the demo.

## Consequences

- New env surface (provider client credentials, redirect URIs, state secret,
  OAuth enable flag), new routes (`/api/auth/:provider/authorize|callback`), new
  error codes, new copy, new client actions.
- Additive Prisma migration (Postgres + SQLite histories), session `via` extension.
- Ops: Google Cloud OAuth client (Web application type, redirect URI
  `https://<production-host>/api/auth/google/callback`) and GitHub OAuth app
  (callback `https://<production-host>/api/auth/github/callback`) must exist
  before the production stack can exercise the flow.
- Tests: mocked IdP flows, route tests, client tests; real IdP flows are
  manual/ops checklist.
- Limitations accepted for this release: no email verification/reset yet, no
  password for OAuth demo accounts, no Android OAuth, no offline for passwordless
  accounts.
