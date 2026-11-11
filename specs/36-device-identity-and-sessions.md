# Spec 36 — One session per device, and a panel that lists devices

## Purpose

The "Signed-in devices" panel in Settings is not a list of devices. It is
`GET /api/auth/sessions`, one row per **server session**, and a session is
minted on every sign-in. On Android that produced thirty-odd rows for one
physical phone:

| What happened | Where |
|---|---|
| The Android session token is memory-only, so it does not survive a process restart | `client/src/lib/api.ts` |
| A lost token means the account gate opens on every cold start | `client/src/App.tsx` |
| A biometric unlock exchanges the device secret for a **brand new session row** | `server/src/auth/service.ts` (`exchangeDeviceCredential` → `createSession`) |
| The previous rows are never revoked, and they live for 30 days | `server/src/auth/service.ts` (`cleanupExpired`) |

Windows Hello does not show the same pile because the browser keeps its
`house_session` cookie for 30 days and simply does not re-authenticate. The
passkey ceremony is not broken; the *session bookkeeping* is.

This spec makes a session belong to a **device** rather than to a sign-in, and
makes the panel say what it is showing.

## Implementation status (2026-11-11)

| Area | Status | Evidence / remaining work |
|---|---|---|
| Device identity on sessions and credentials | Implemented | `Session.deviceCredentialId` and `DeviceCredential.deviceId`; `Session` rows are reused, not duplicated. |
| Token rotation on reuse | Implemented | `rotateSession` issues a fresh token on the existing row; the previous token stops validating immediately. |
| Panel lists devices | Implemented | `GET /api/auth/sessions` returns `{ devices: [...] }`; `SessionSettings.tsx` renders one row per device. |
| Signing a device out | Implemented | `DELETE /api/auth/sessions/device/:key` revokes every session the device holds. |
| Bulk sign-out | Implemented | `DELETE /api/auth/sessions/others` revokes every session except the caller's. |
| Legacy pile cleanup | Implemented | `server/scripts/prune-device-sessions.ts` revokes superseded `via=device` rows; dry-run by default. |
| Biometric gate unchanged | Implemented | A cold start still prompts. The prompt is the gate, not a side effect of session bookkeeping. See ADR 027. |
| Offline enrolment upgrade | Implemented | A vault entry saved without a secret is upgraded in place once the server is reachable, instead of pinning the app offline. |
| Re-enrolment keyed on the vault | Implemented | An invalidated Keystore key re-enrols the same credential instead of creating a second one. |

## Decisions

1. **A device credential is the anchor.** `Session.deviceCredentialId` links a
   session to the credential it was minted from. The link is server-generated and
   unforgeable.
2. **The client-supplied `deviceId` is a label, never an authorisation input.**
   The Android app sends a stable installation id so two phones can be told
   apart and so a re-enrolled phone keeps its identity. The server stores it and
   displays it; it never uses it to decide which session to reuse. Reuse is
   keyed on `deviceCredentialId` alone.
3. **Exchanging a device secret rotates a token; it does not insert a row.**
   One device holds one live session. The token rotates because only its hash is
   stored, so the old token cannot be re-issued.
4. **The panel lists devices.** `GET /api/auth/sessions` returns one entry per
   device. A browser session is a device of its own, keyed by its session id;
   an Android device is keyed by its credential id.
5. **The biometric gate stays.** A cold start still asks for the fingerprint.
   The prompt is the privacy boundary, not an artefact of session handling.
   ADR 027 records this and the alternative that was rejected.
6. **A revoked device credential revokes its sessions.** Signing a device out
   removes the credential's sessions; revoking the credential itself also ends
   them, so a stolen phone cannot keep a session that nobody can use.

## Behaviour

### The device identity

A device credential gains a `deviceId`: a stable installation identifier the
Android client generates once and keeps in `localStorage`. It survives app
restarts and app updates, and is regenerated if the app's data is cleared.

The identifier exists for two reasons: to tell two Android phones apart in the
panel (both report `Android device` from the user agent alone), and to let a
phone that re-enrols keep the same identity.

The server treats it as opaque display data. It is length-bounded and
validated, and it is never used to authorise anything.

### Enrolling a device

`POST /api/auth/devices` gains an optional `deviceId` and continues to take a
`label`. The Android client sends the phone's model as the label (`Pixel 4a`)
rather than the literal string `This device`, so the panel names the phone.

The server stores both on the credential. Enrolling twice for the same profile
creates two credentials; that is deliberate, because a credential is a
*secret*, and two phones cannot share one.

### Exchanging a device secret for a session

`POST /api/auth/devices/session` exchanges the device secret for a session.

- If the credential has a live session, that session's **token is rotated**: a
  new token is issued and stored against the same row, and the old token stops
  validating immediately. The row keeps its id and its original creation date,
  so the panel's "first signed in" date is the truth.
- If it has none (first sign-in, a revoked session, or the 90-day hard cap),
  a new row is created.

The session's `deviceLabel` is taken from the credential, so re-labelling a
device updates the panel.

A reused session still honours the 90-day hard cap from its creation date. When
that cap is reached the next exchange starts a fresh row, and the panel's
"first signed in" date moves forward.

### The signed-in devices panel

`GET /api/auth/sessions` returns:

```jsonc
{
  "devices": [
    {
      "key": "6f1c…",              // credential id, or the session id for a browser
      "label": "Pixel 4a",         // the enrolled name, or a user-agent label
      "via": "device",             // profile | device | household
      "createdAt": "2026-10-29T…", // first sign-in on this device
      "lastActiveAt": "2026-11-11T…",
      "current": true,             // this row is the caller's own session
      "sessions": 1                // live sessions this device holds
    }
  ]
}
```

`key` is opaque to the client and only meaningful to the two routes below.

The panel renders one row per device: the name, when it was last active, and a
**Sign out** action. A device that holds more than one live session — only
possible for rows created before this spec — says so, because the number is the
truth and a hidden count would be a lie.

### Signing a device out

- `DELETE /api/auth/sessions/device/:key` revokes **every** session the device
  holds. `key` is a credential id or a browser session id; the server resolves
  both and is scoped to the calling profile.
- `DELETE /api/auth/sessions/:id` continues to revoke one session by id.
- `DELETE /api/auth/sessions/others` revokes every session the caller holds
  except the one they are using. This is the cleanup for a household that
  already has the pile.

### The biometric gate stays

A cold start on Android still asks for the fingerprint or face. The prompt is
what makes the phone the profile's device, and it is the boundary the privacy
model rests on.

What changed is what happens *after* the prompt: the app now reuses the
device's session instead of adding another one, so the prompt is cheap in the
sense that matters — it does not grow the household's device list.

The alternative — restoring the session silently from the Keystore, with the
prompt reserved for the offline cache — is recorded in ADR 027 and rejected.

The one behaviour that does change is a **bug fix**: after the five-minute
background lock the app cleared its token but kept looking signed in, so every
request failed with a 401 and the app was unusable until it was restarted. The
lock now returns the app to the account gate, where the prompt belongs.

### The offline enrolment gap

Enrolling biometrics while the server is unreachable stores the profile key in
the Vault but no device secret, because there is no server to ask. That entry
could not sign in online afterwards: the client saw no secret, assumed it was
offline, and never contacted the server again.

The entry is now **upgraded in place**: the next unlock that finds a server
registers a device credential and rewrites the Vault entry with the secret.
The upgrade happens inside the biometric prompt that is already open, so it
costs no extra prompt.

### Re-enrolment is keyed on the Vault

Automatic enrolment after a password sign-in was skipped whenever the *server*
already held a credential for the profile. That is the wrong test: when the
Keystore key is invalidated (a new fingerprint enrolled), the Vault entry is
cleared while the credential survives, so biometrics could never be set up
again without going into Settings — where each attempt created *another*
credential.

Automatic enrolment is now skipped only when the Vault already holds a secret.
An invalidated key re-enrols the same credential instead of adding a second.

## Data model

Additive migration; no column is removed or repurposed.

```prisma
model Session {
  // existing fields...
  deviceCredentialId String?   // the device this session belongs to

  deviceCredential DeviceCredential? @relation(fields: [deviceCredentialId], references: [id], onDelete: SetNull)
  @@index([deviceCredentialId])
}

model DeviceCredential {
  // existing fields...
  deviceId String?   // client-supplied installation id; display only
  sessions  Session[]
}
```

`deviceId` on a credential is deleted with the credential. `deviceCredentialId`
on a session is set to null if the credential is deleted, so a removed device
leaves a revoked-but-readable session rather than a broken foreign key.

## API

| Method | URL | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/auth/devices` | profile session | Enrol a device; body `{ label?, deviceId? }` |
| `GET` | `/api/auth/devices` | profile session | List the caller's device credentials |
| `DELETE` | `/api/auth/devices/:id` | profile session | Revoke a device credential |
| `POST` | `/api/auth/devices/session` | public | Exchange a device secret for a session; body `{ secret, deviceId? }` |
| `GET` | `/api/auth/sessions` | profile session | List the caller's **devices** (`{ devices: [...] }`) |
| `DELETE` | `/api/auth/sessions/:id` | profile session | Revoke one session by id |
| `DELETE` | `/api/auth/sessions/device/:key` | profile session | Sign one device out |
| `DELETE` | `/api/auth/sessions/others` | profile session | Sign every other device out |

`GET /api/auth/sessions` changed its response shape from `{ sessions: [...] }` to
`{ devices: [...] }`. The client is the only consumer.

## Error codes

| Code | HTTP | Meaning |
|---|---|---|
| `device_not_found` | 404 | No device credential with that id for this profile |
| `session_not_found` | 404 | No session with that id for this profile |
| `device_auth_failed` | 401 | The device secret is unknown, revoked or expired |

## Security rules

- The server never accepts a `deviceId` as proof of anything. Session reuse is
  keyed on `deviceCredentialId`, which only the server can mint.
- `DELETE /api/auth/sessions/device/:key` and `DELETE /api/auth/sessions/others`
  are scoped to the calling profile. A member cannot sign out another member's
  device by guessing a key.
- Rotating a token invalidates the previous one immediately. There is no window
  in which two tokens are live for the same device.
- The device secret is still only ever returned once, at enrolment, and only
  its SHA-256 hash is stored.
- The `deviceId` is opaque, length-bounded, and never logged or returned with
  a secret.
- Signing a device out revokes its sessions. Revoking a credential ends its
  sessions too.

## Migration

Additive columns only; no data is rewritten and no row is deleted. Sessions
created before this spec have a null `deviceCredentialId` and are grouped by
their session id, which is how a browser session is grouped anyway.

The pile that predates this spec is cleaned by
`server/scripts/prune-device-sessions.ts`, which revokes superseded
`via=device` rows. It is dry-run by default and requires `--apply` to change
anything.

## Copy

Every user-facing string lives in `client/src/copy.ts` and passes
`make check-copy`. The panel's wording changes from sessions to devices:

- the heading stays **Signed-in devices**;
- the introduction says the panel lists *devices*, not sign-ins;
- a row with more than one live session says how many;
- the bulk action says what it signs out.

## Acceptance criteria

- [x] Exchanging the same device secret twice leaves **one** session row, not two.
- [x] The token issued by the first exchange stops validating after the second.
- [x] Two device credentials produce two rows and two independent sessions.
- [x] `GET /api/auth/sessions` returns one entry per device.
- [x] A device's label is the enrolled name, not the user agent.
- [x] `DELETE /api/auth/sessions/device/:key` revokes every session the device holds.
- [x] `DELETE /api/auth/sessions/others` leaves the caller's own session alone.
- [x] A member cannot revoke another profile's session by key.
- [x] Revoking a device credential ends its sessions.
- [x] A Vault entry with no secret is upgraded in place once the server answers.
- [x] An invalidated Keystore key re-enrols the same credential, not a new one.
- [x] After the five-minute background lock the app returns to the account gate.
- [x] The pruning script is dry-run by default.

## Manual checks

1. **Android (Pixel 4a).** Sign in with a password, enable fingerprint unlock,
   force-stop the app, reopen it, unlock with the fingerprint, and repeat five
   times. Settings on the web must show **one** Android device, last active now.
2. **Android.** Enrol fingerprint unlock while the server is unreachable, then
   bring the server back and unlock. The app must sign in online, not stay
   offline.
3. **Android.** Enrol a new fingerprint, then sign in with the password. The
   fingerprint must work again without creating a second device.
4. **Windows.** Sign in with Windows Hello twice. The panel shows two browser
   sessions; "Sign out all other devices" clears one of them.

## Testing

- Server: device exchange reuses the row and rotates the token; the panel
  groups by device; every revoke route is profile-scoped; the pruning script
  keeps the newest row per user agent.
- Client: the panel renders one row per device and signs one out; the offline
  enrolment upgrade; the background lock returns to the gate; the device name
  parsed from the user agent.
- `make check-copy` for every new string.

## Phases

1. **Phase 1 — server.** Schema, migration, session reuse, token rotation, the
   panel API, the revoke routes.
2. **Phase 2 — client.** The panel renders devices; the Android client sends a
   device id and a device name.
3. **Phase 3 — cleanup.** The bulk sign-out and the pruning script.
4. **Phase 4 — the gate.** The background lock returns to the account gate.
5. **Phase 5 — the vault.** Offline enrolment upgrade and vault-keyed
   re-enrolment.

## Not in this spec

- **Silent session restore.** Rejected in ADR 027; the prompt stays.
- **Grouping browser sessions by device.** A browser profile is a device, so
  two Chrome profiles are two rows. Deciding that is a browser's business.
- **Push notifications or a device registry.** The panel is the whole surface.
- **Automatic pruning of old sessions.** The 30-day TTL already does that; the
  script exists for the legacy pile, not as a routine.
