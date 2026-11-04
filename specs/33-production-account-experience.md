# Spec 33 — Production account experience without profile selection

## Purpose

The production deployment is a public-facing web demo, while local development
remains a household app. The production UI should behave like a conventional
single-person account product: a person signs into their account, sees their
own library state, and can reach basic account information from the header.
They should not see a household profile picker, profile names, or profile
switching controls.

This is a **production-only experience**. It does not replace or alter the local
household workflow, where named profiles and profile switching remain useful.

Related identity foundation: [Spec 32](32-oauth-email-signin.md) and
[ADR 023](../decisions/023-oauth-email-signin-production-demo.md). This spec
supersedes neither the Profile-is-the-account data model nor the local UI.

## Status (2026-11-04)

Plan accepted 2026-11-04. Implementation underway; initial account-mode and
signup paths are present, but the privacy audit and complete regression suite
are unfinished. This is not release-ready. Phase plan:

1. Documentation and decisions (this spec, ADR 024, roadmap, LIMITATIONS).
2. Production identity/privacy audit and auth-foundation corrections required
   for safe production use. (In progress; not release-ready.)
3. Production-only client mode: account sign-in/sign-up, account header menu,
   and no profile selection or names.
4. Server-side production account policy and API privacy enforcement.
5. Regression, security, E2E and deployment verification.

## Decision summary

- The mode is enabled explicitly by a server-controlled deployment setting
  (`ACCOUNT_EXPERIENCE=demo`); it is never inferred from `NODE_ENV` or chosen by
  a browser request. Missing/unknown setting defaults to household mode.
- Production demo accounts continue to use `Profile` as the backing account
  record (ADR 016/023). Do not add a separate user table in this feature.
- The production demo has no profile selection: a successful sign-in resolves
  exactly one account/profile and establishes the active profile in the session.
- Profile names remain internal compatibility data. The demo surface must not
  render or return them to ordinary account clients. Internal generated labels
  must not be presented as names to the listener.
- The header account menu exposes only the signed-in account identity needed to
  recognise the session (email when present, otherwise provider label) and a
  sign-out action. It does not expose profile name, profile id, role, or a
  switch-account/profile-switch affordance. Admin/operator surfaces remain on
  their separate listener.
- The production demo supports Google and GitHub OAuth and email/password
  sign-up/sign-in. Email verification/reset remain out of scope for this
  release; email sign-up must still validate and normalize the address and
  prevent duplicate account identities.
- Local mode retains current household sign-in, profile creation, profile
  picker, switcher and offline behavior unchanged.

## Behaviour

### Production sign-in and account creation

- A signed-out demo visitor sees one account-oriented entry surface, not a list
  of profiles. It offers the configured Google/GitHub sign-in options and
  email/password sign-in plus account creation.
- OAuth success creates/resolves one demo account and enters the app directly.
- Email account creation collects the minimum required values, creates a
  member account, signs it in, then enters the app directly. There is no
  profile-name step.
- Failed sign-in/sign-up has reviewed copy and does not disclose whether an
  email exists. Provider errors return to the sign-in surface safely.
- Passwordless OAuth accounts remain passwordless. Email verification and
  password reset are explicitly deferred and must not be implied by the UI.

### Signed-in demo experience

- No profile picker, profile switcher, add/delete-profile affordance, or
  household break-glass action appears in the demo client.
- The top-right account menu identifies the signed-in account using email when
  available; otherwise it uses a generic provider identity. It offers sign out.
- Every account-scoped action uses the profile/account bound to the server
  session. A client cannot select another profile by changing local storage,
  headers, route parameters or request payloads.
- Existing data that is profile-scoped (progress, favourites, history, lists)
  remains isolated to the signed-in account.
- Library browsing and listening use the hosted demo library. Operator/admin
  controls remain unavailable on the public listener.

### Local household experience

- When `ACCOUNT_EXPERIENCE` is unset or `household`, current local behavior is
  unchanged: household/profile sign-in, named profile selection and switching,
  profile management, and the established offline behavior.
- OAuth configuration remains independently disabled unless explicitly
  enabled; demo mode must not be activated by client-controlled input.

## Server and API requirements

- Resolve mode from validated server configuration and include it in an
  appropriate public capability/config response so the client can choose the
  correct surface without guessing. Never let a request parameter toggle it.
- In demo mode, sign-in must create a session with one bound profile. Routes
  that accept profile IDs must either derive the identity from the session or
  reject IDs that do not match the session profile.
- Audit public/authenticated endpoints and serialized responses. Profile names,
  profile lists, internal profile IDs, household account administration, and
  other accounts' data must not be exposed to ordinary demo sessions.
- Do not rely on hiding client controls as authorization. Enforce demo policy
  server-side.
- Use Fastify schemas for sign-up/login input. Normalize email consistently;
  enforce unique identity resolution without leaking account existence.
- OAuth must validate the correct callback URI, one-time state, PKCE, provider
  identity and verified-email claims before linking identities. No linking on an
  unverified email. Do not claim OIDC validation that the implementation does
  not perform.
- Session sign-out revokes the server session and clears relevant client state.

## Security and privacy constraints

- Demo mode is an explicit deployment setting and server authority.
- No user-supplied profile ID can change account scope in demo mode.
- Do not expose profile names or provider tokens/client secrets to the browser.
- Do not link OAuth identities to an existing account unless the provider
  supplies a verified email and the provider response itself has been
  validated.
- New email/password credentials use the existing password hashing and
  lockout/rate-limit posture; account creation is rate-limited.
- Avoid logging raw email addresses, OAuth codes, tokens, state, verifier, or
  passwords.

## Acceptance criteria

- [ ] Production setting selects demo experience; unset/local setting preserves
      household mode.
- [ ] Demo sign-in offers supported account sign-in and email account creation;
      successful sign-in enters the app without choosing/renaming a profile.
- [ ] Demo header shows minimal account identity and sign out, never profile
      names, profile selection, or profile administration.
- [ ] Demo client/API does not disclose profile names or account lists to normal
      users.
- [ ] Demo requests cannot read/write another account's progress or other
      profile-scoped data by forging IDs/headers/payloads.
- [ ] Server binds each demo session to exactly one account/profile.
- [ ] OAuth state/PKCE/callback and verified-email linking are tested; an
      unverified email cannot link an existing account.
- [ ] Email sign-up validates inputs, stores a hash only, handles duplicate
      identities without enumeration, and signs in the new account.
- [ ] Household-mode UI and API behavior remains covered by regression tests.
- [ ] Production and local builds/typechecks, server/client suites, copy gate,
      and relevant Playwright flows pass.

## Testing

- Server unit and Fastify `inject` tests for mode selection, account creation,
  account binding, privacy serialization, and cross-account denial.
- OAuth tests with mocked provider endpoints and invalid/unverified identity
  claims; test callback URI construction behind the production proxy.
- Client tests for mode-specific sign-in, absence of profile UI/name, account
  menu and sign-out behavior, plus unchanged household mode.
- Playwright tests exercise production-demo and household modes independently.
- Manual release checklist verifies actual provider callbacks and confirms no
  profile names or cross-account data appear in the deployed demo.

## Not in this spec

- Email verification, password reset, MFA, account deletion/export, and account
  linking UX.
- Replacing `Profile` with a separate user/account model.
- Changing the local household UX or Android/offline behavior.
- Public self-service admin/operator access.
