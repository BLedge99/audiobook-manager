# Spec 03 — Per-User Profiles & Household Auth

## Purpose

The app will serve several non-technical household members. Each person needs
their own profile so progress and history are isolated, and the whole app
should sit behind one simple shared household password (no per-user accounts
with individual credentials yet).

## Behaviour

- On first launch (or when no profile is selected), show a profile switcher
  listing existing profiles plus "Add profile". The app does not render
  until a profile is chosen (ProfileGate) — progress is profile-scoped,
  so playback without one would silently lose data.
- A profile has: id, display name, optional colour/avatar, creation date.
  Profile names are unique; creating a duplicate returns 409 and the
  client shows an error instead of a second entry.
- The selected profile is stored client-side (localStorage) and sent with API
  calls via a header (e.g. `x-profile-id`) — the DB is keyed by profile.
- A single household password gates the whole app: on first visit, ask for the
  password; store a signed cookie/token. All API routes reject calls without a
  valid session. The password lives in server env config.
- If the server has no profiles, show a **Create profile** form rather than a
  dead-end empty state. Registration requires the household password, a profile
  name, and a new profile password. The server validates the household password,
  creates the profile, and returns a profile-bound session. The client never
  stores the household password.
- If profile loading fails, show the connection/authentication error; do not
  reinterpret a failed request as an empty profile list or allow offline
  registration.
- Native clients may explicitly continue in offline mode from the account or
  profile gate. This opens only device-held downloads and locally unlocked
  private data. It does not create a server profile or validate a household
  password. The choice persists across app restarts until the listener saves a
  working server address with **Save and test** in Settings, which ends the
  offline choice (a reachable server is proof it can end).
- An offline biometric unlock that cannot establish a server session is an
  offline sign-in: clear the in-memory server credential, retain the remembered
  profile id, and do not probe the server again during that offline session.
- No password reset flows, no usernames, no emails. If the password is lost,
  the operator sets a new one in env and everyone re-enters it.

## Data model deltas

- `Profile { id, name, color, createdAt }`
- `ListeningHistory` gains `profileId` FK; all per-profile queries filter by it.

## API deltas

- `POST /api/auth/login` { password } → session cookie; `POST /api/auth/logout`.
- `POST /api/auth/register-profile` { name, householdPassword, password } →
  validates the household key, creates a profile account, and issues a
  profile-bound session.
- `GET/POST /api/profiles`, `DELETE /api/profiles/:id`.
- All existing routes read `x-profile-id` where user state is involved.

## Acceptance criteria

- [x] A wrong password cannot reach any API route (401).
- [x] Two profiles have fully separate progress rows for the same book.
- [x] Deleting a profile removes its profile-scoped rows.
- [x] Switching profiles in the UI immediately swaps displayed progress.
- [x] Profile names are unique (409 on duplicate; enforced by DB unique index).
- [x] Default household profiles (Dad, Mum, Archie, Ben, Playwright, Testing) are seeded on first boot of an empty DB.
- [x] A household member can register a profile with the household password; an empty account list has an explicit registration path.
- [x] API failures are distinct from a confirmed empty profile list; offline mode never invents temporary server profile IDs or stores the household password.
- [x] Tests: route tests for auth gate; E2E for login → profile pick → play.

## Manual checks

1. Log in on a phone browser, create profile "Sam", play to 5 min.
2. Switch to profile "Alex" → position shows 0 for that book.

## Testing

- Vitest route tests for auth + profile CRUD; Playwright E2E for the full flow.

## Not in this spec

- Individual per-user credentials, roles, remote internet exposure.

## Demo deployments

- The household password (`APP_PASSWORD`) remains accepted on demo deployments
  that configure one (`ACCOUNT_EXPERIENCE=demo`): `POST /api/auth/login` with
  `{ password }` returns 200 with `profile: null` and `via: "household"`.
- A demo household session carries no account scope: no profile is bound, so
  account-scoped routes require a profile-bound session (401 otherwise).
  Demo behavior is governed by Spec 33; local household behavior in this spec
  is unchanged.
