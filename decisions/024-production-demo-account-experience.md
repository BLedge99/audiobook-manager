# ADR 024 — Production demo uses an account surface, household mode stays local

## Status

Accepted 2026-11-04. Follows ADR 016 (profiles are accounts), ADR 019
(PostgreSQL production, SQLite local), and ADR 023 (external sign-in for the
production demo). Spec: [`specs/33-production-account-experience.md`](../specs/33-production-account-experience.md).

## Context

The production deployment is now an online demo for independent visitors.
Household-oriented UI assumes one household with several named listeners: a
profile picker at sign-in, a profile switcher in the header, and management
controls. Those concepts are useful locally but are confusing and privacy-wrong
for a public demo where each visitor has an individual account. The requested
experience is an account sign-in screen and small account menu, with no profile
selection and no profile names shown to demo users.

The application already treats `Profile` as the account record (ADR 016), and
progress/history are profile-scoped. Replacing that model would be a much larger
identity migration than the user-facing need requires. Conversely, merely
hiding the picker is insufficient: APIs that expose profile names or accept
client-selected profile IDs could still reveal or cross account boundaries.

## Decision

1. **Separate the experiences by server deployment configuration.** An explicit
   `ACCOUNT_EXPERIENCE=demo` setting enables the production account surface.
   The default remains `household`. The browser cannot choose the mode.
2. **Keep Profile as the backing account.** A successful demo authentication
   binds the session to exactly one profile. No separate user table is added.
3. **Do not expose household profile concepts to demo users.** No profile list,
   picker, switcher, profile name or profile administration is available in the
   ordinary production demo surface. The account menu shows only the account
   identity needed to recognise the session and sign out.
4. **Enforce account isolation on the server.** Demo requests derive account
   scope from the authenticated session; supplied profile IDs cannot select
   another account. API serialization is audited for names and cross-account
   data. UI hiding is not an authorization control.
5. **Implement email account creation as part of the demo entry surface.**
   Password hashing, normalization, uniqueness, generic errors, rate limiting
   and direct sign-in are required. Email verification and password reset stay
   deferred, consistent with ADR 023.
6. **Preserve local household behavior.** Unset/default mode keeps the current
   profile picker, switcher, management behavior and offline rules. OAuth/demo
   mode is never inferred from `NODE_ENV`.

## Alternatives considered

- **Remove profile UI globally.** Rejected: it would regress the household
  workflow and its established offline/device behavior.
- **Only hide the controls in the client.** Rejected: endpoints or forged IDs
  could still reveal names or access another profile's data.
- **Introduce a new Account/User table now.** Deferred: `Profile` already owns
  authentication and profile-scoped state. A second identity model is not
  required to deliver the production UX and would need broader migration/linking
  semantics.
- **Select mode from `NODE_ENV` or a query parameter.** Rejected: deployment
  intent should be explicit, and clients must not be able to choose a weaker
  policy.

## Consequences

- Adds an explicit server-side mode setting and a public capability surface.
- Requires an endpoint/serializer and account-scope audit, not just client
  conditional rendering.
- Email self-sign-up is part of the production account surface and needs
  dedicated abuse, duplicate-identity and credential-storage tests.
- Local UI stays intact; both modes require regression coverage.
- The existing OAuth foundation must be reviewed and corrected where its
  implementation or docs do not satisfy callback, verified-email, state/PKCE,
  or identity-validation requirements before production release.
