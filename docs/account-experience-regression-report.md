# Account experience regression report

## Summary

The production server's `ACCOUNT_EXPERIENCE=demo` setting was not being read by
the current server application builder. This caused the app to advertise and
enforce household mode even when the production `.env` and Compose environment
specified demo mode. The server-side environment resolver present at
`05fa36e36f60f4bdfa285a71e6b32af15bbeaff4` was dropped during the
`dc4263d` server route/application refactor.

The resolver has been restored. The production sign-in screen also now renders
only OAuth providers that the server reports as configured. Household profile
password sign-in has been covered by a new client regression test.

## What changed

At the reference revision, `server/src/app.ts` resolved the mode from
`process.env.ACCOUNT_EXPERIENCE` when the caller did not explicitly supply
`accountExperience`. It accepted the trimmed, case-insensitive value `demo`
and otherwise defaulted to `household`.

The refactored `buildApp` replaced that resolution with a destructured
`accountExperience = "household"` default. The production startup in
`server/src/index.ts` calls `buildApp` without an explicit mode, so the new
default bypassed the environment setting. `docker-compose.prod.yml` still
passes `${ACCOUNT_EXPERIENCE:-household}` into the app container; the supplied
`demo` value was therefore present but ignored by `buildApp`.

## User-visible and server-side impact

Because `/api/config` used the incorrectly selected mode, the browser received
`accountExperience: "household"`. The client consequently showed the household
profile picker and local account flow rather than the production account
surface. Demo-only server policies were also not active: profile-listing and
household-management routes followed household behavior, and email account
creation was not enabled through the demo route configuration. The OAuth
capability configuration was available from the server, but the demo-only
client view that uses it was never selected.

This was a server configuration-selection failure, not a bad production `.env`
value or a change to the OAuth provider credentials/callback workflow.

## Changes made

- Restored environment-based mode resolution in `buildApp`, retaining
  household mode as the safe fallback and respecting an explicitly supplied
  `accountExperience` override.
- Added a Fastify integration test that sets `ACCOUNT_EXPERIENCE=demo`, omits
  the builder override, and verifies both `/api/config` and the hidden
  household account-list route.
- Changed the demo login screen to show Google/GitHub links only when the
  server reports those providers as enabled; this avoids displaying dead
  provider options when OAuth is not configured.
- Added a local household client test covering profile selection, password
  submission, session-token handling, and active profile selection.

## Local household account review

The local account path remains separate from demo mode: it loads the household
account list, supports selection of a named profile, and submits
`{ profileId, password }` to `/api/auth/login`. The new client test exercises
that complete sign-in path. Existing server auth-route tests cover household
password/profile authentication, and the existing profile-registration and
offline recovery tests remain in the suite.

Demo OAuth and email account creation remain separate from this local path.
Provider credentials, redirects, and real Google/GitHub callbacks are
deployment-specific and were not exercised against external identity
providers here.

## Verification

- `npm run test:server` — passed (581 passed, 3 skipped).
- `npm run test:client` — passed (583 tests).
- `npm --prefix server run build` — passed.
- `npm --prefix client run build` — passed; Vite reported the existing large
  chunk advisory.

After deploying, confirm the container receives `ACCOUNT_EXPERIENCE=demo`,
`OAUTH_ENABLED=true` as intended, and the correct Google/GitHub client IDs,
secrets, and callback URIs. Then verify `/api/config` returns `demo` and the
configured provider list before testing live OAuth sign-in.
