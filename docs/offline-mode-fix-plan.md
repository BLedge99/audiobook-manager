# Offline sign-in and profile setup

**Updated:** 2026-11-05

**Status:** Implemented; automated checks pass. Physical Android
resume/fingerprint acceptance remains a manual check.

This replaces the earlier plan's temporary local profiles, household-password
storage, and offline password bypass. Those approaches could not create a real
server account, could strand the listener with an invented ID, and risked
storing a household secret on the phone.

## What was going wrong

The app's account/profile gates depend on different server routes. A failed
account or profile-list request was rendered as an empty list, which made a
network/authentication failure look like a server with no profiles. The empty
account state only told the listener to use the household password, but there
was no signup flow to create a profile with it.

The previous offline fallback created negative temporary profile IDs and wrote
the household password to `localStorage`, but there was no server endpoint to
reconcile those temporary profiles. Separately, an authentication failure could
clear the last locally remembered profile ID, breaking the link to its offline
cache. The `offlineMode` check in the server probe also used a stale closure,
and starting in persisted offline mode did not initialize the app's offline
branch.

## Intended state transitions

| Starting state | Action / result | Next state |
|---|---|---|
| Connected, signed out | Server confirms zero profiles | Show profile registration (name, household password, new profile password) |
| Connected, signed out | Account list request fails | Show the request failure; never report an empty list |
| Connected, signed out | Listener chooses **Continue offline** | Persist explicit offline mode, clear in-memory server credentials, open local offline gate |
| Connected, fingerprint sign-in | Server device exchange succeeds | Continue signed in online |
| Connected, fingerprint sign-in | Local Vault unlock succeeds but server exchange is unreachable/not configured | Enter explicit offline mode with the local key retained; do not probe again |
| Explicit offline mode | App restarts, refreshes, or returns to foreground | Stay offline; do not issue API requests or probes |
| Explicit offline mode | Listener selects **Reconnect to server** in Settings | Clear the preference, enable API calls, probe and show the normal sign-in/setup flow |

Unexpected server loss remains distinct from explicit offline mode: a failed
probe opens the existing offline gate, and normal recovery can retry when
appropriate. The explicit choice is persisted because it means “do not contact
the server until I reconnect,” not merely “the last request failed.”

## Profile registration contract

`POST /api/auth/register-profile` is public only in the sense that it can be
called before a session exists. It requires a valid household password and
creates a real member profile with its own password and a profile-bound session.
Fastify validates the request shape; `AuthService` validates the household key,
the profile password policy, profile-name uniqueness, and failed household-key
attempts. A successful response contains the same safe profile/session shape as
profile sign-in.

The household password exists only in the registration form and request body.
It is not written to local storage, the offline cache, or a pending-profile
record. Offline mode cannot validate the household password, create accounts,
or assign temporary profile IDs. Offline profile-key setup remains password
based after a profile exists; biometric unlock can reopen a locally stored key.

## Implementation boundaries

- `client/src/App.tsx`: persisted explicit mode, credential clearing,
  reachability separation, biometric offline transition, and manual reconnect.
- `client/src/lib/api.ts`: reject API requests through both the global fetch
  shim and bounded fetch while explicit offline mode is active.
- `client/src/components/AccountGate.tsx` and
  `client/src/components/ProfileGate.tsx`: distinguish confirmed empty lists
  from failed requests and expose real registration.
- `client/src/components/ProfileRegistration.tsx`: shared registration form.
- `server/src/auth/routes.ts`, `server/src/auth/service.ts`, and
  `server/src/app.ts`: validated, household-password-protected registration.
- `specs/03-user-profiles-auth.md`, `specs/28-accounts-passkeys-biometrics.md`,
  and `specs/29-offline-resilience.md`: behavior and acceptance contract.

## Regression checklist

- Empty account list shows signup; failed account/profile requests do not show
  “no profiles.”
- Registration rejects a wrong household password, duplicate name, and a
  password that violates the profile policy; success creates a server profile
  and profile session.
- Registration never stores the household password or creates a temporary
  profile ID.
- A local biometric unlock with no server session enters offline mode without
  wiping the just-unlocked cache.
- Explicit offline mode is honored on cold start and suppresses API calls,
  focus probes, and server refreshes.
- Reconnect reenables requests and probes the configured server.
- Existing offline unlock exits, per-server shelves, and profile isolation
  continue to work.
- On-device acceptance: sign in with fingerprint, make downloaded audio
  available offline, lock/switch apps, return with the server unavailable, and
  confirm the local offline library appears instead of the empty account gate.
