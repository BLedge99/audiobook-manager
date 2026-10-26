# Spec 28 — Profiles are accounts: passwords, passkeys and device unlock

## Purpose

The household can name profiles, but it cannot protect them. One shared
password opens the app and `x-profile-id` chooses who the caller claims to be.
Anyone who knows that password can read or change anyone's progress,
favourites, wishlist and library by editing one header.

This spec makes a **profile an account**: a password of its own, a session that
the server derives the profile from, an `admin`/`member` role, Windows Hello
passkeys on the web, fingerprint/face unlock on Android, and an encrypted
offline cache that a profile password (or the phone's biometric) unwraps.

It is written before the code, per `AGENTS.md`. The architectural decision and
the rejected alternatives are in
[`decisions/016-profiles-are-accounts.md`](../decisions/016-profiles-are-accounts.md).

## Implementation status (2026-10-26)

Implementation is present through phases 1-8; automated checks pass, while the
deployment and physical-device acceptance checks below remain outstanding. The
current evidence is:

| Area | Status | Evidence / remaining work |
|---|---|---|
| Profile accounts, sessions, roles, password recovery and encrypted cache (phases 1-4) | Implemented | `make test`: 507 server tests and 401 client tests pass; `tsc --noEmit` is clean at both tiers; `check-copy` is clean (422 strings, 0 errors/warnings). |
| Android biometrics (phase 5) | Implemented; smoke checked on Pixel 4a | APK installed and app launched without a fatal exception. Automated enrollment, online exchange, revocation, cancelled-prompt fallback, offline DEK restore and offline UI tests pass. Real sensor enrollment/sign-in, background lock and offline unlock still need device interaction with a configured server/profile. Motorola Defy check remains. |
| Web passkeys (phase 6) | Implemented; automated flow verified | Server ceremony tests and Playwright virtual-authenticator registration/sign-in pass. Real Windows Hello checks remain. |
| Automated suites | Pass | Server 507/507 and client 401/401 pass; copy check clean (422 strings). Playwright: **51 passed** (4.3m, chromium + security, no flaky retries), including the passkey virtual-authenticator flow and the profile-isolation cases. |
| HTTPS deployment (phase 7) | Implemented; not deployed/accepted | Production Caddy config, `books.home.arpa`, TLS internal CA setup docs, exact CORS origin and secure cookie config are present. The `Caddyfile` validates with `caddy:2.11.7-alpine` and the production Compose file resolves with `docker compose config`. Still need to install/trust the root CA on Windows; Windows Hello on that origin remains unverified. Android still uses HTTP on LAN per ADR 014. |
| Final hardening (phase 8) | Implemented; manual checks remain | Five-minute profile/resource-scoped media tokens, session list/revoke UI, URL-token logging redaction, copy review, expired-row cleanup and the migration rehearsal are implemented and covered by unit/integration tests, including an automated pre-account database migration test. Manual Windows/Android checks remain. |


The device check proves installation and startup only. It does not prove the
biometric prompt or authentication ceremony works on the physical sensor.

## Decisions

Confirmed with the household:

1. **Profiles are accounts.** `admin` and `admin-test` are admins; `ben`, `dad`,
   `mum`, `archie` and `test` are members. Existing data is preserved; existing
   `Playwright` becomes `test` and existing `Testing` becomes `admin-test`.
2. **Normal users enter one password.** `APP_PASSWORD` is break-glass/recovery
   and profile claiming, not a daily second factor for anyone, including an
   admin.
3. **Passwords are 8+ characters.**
4. **Passkeys are for the Windows web front end**, through Windows Hello. The
   Android app does not use passkeys.
5. **Android uses native fingerprint/face unlock**, not WebAuthn.
6. **Offline mode requires the profile password**, and the private cache is
   encrypted. A hash alone is not enough.
7. **HTTPS is part of this work.** The production web address is
   `books.home.arpa`, served by Caddy with `tls internal`; its local CA is
   installed on the Windows machines. `http://localhost` remains a valid secure
   context for development and Playwright.
8. **Test accounts never get a known production password.** `test` and
   `admin-test` are seeded with env-provided passwords only when test seeding is
   enabled (development and CI).
9. **No automatic deletion.** `Archie` stays if already present, but is not
   seeded on a fresh install. Removing a profile remains an explicit admin
   action with its history warning.

## Account model

`Profile` is the account. There is no second user table.

| Profile | Role | Notes |
|---|---|---|
| `admin` | admin | The household owner's daily account |
| `admin-test` | admin | Test only; created only when test seeding is on |
| `ben` | member | |
| `dad` | member | |
| `mum` | member | |
| `archie` | member | Kept if present; not seeded fresh |
| `test` | member | Test only; created only when test seeding is on |

An admin can:

- scan the library, add/remove library roots and start enrichment;
- manage the genre/tag vocabulary and review queue;
- create, rename and remove profiles;
- reset a member's password and revoke their sessions and devices.

A member can:

- read the shared catalogue and their own library;
- change their own progress, favourites, wishlist and library membership;
- change their own password and manage their own passkeys/devices.

A member cannot read or write another profile's private rows. A member cannot
call an admin route; the answer is `403 forbidden`.

Every profile has a password. A profile with `passwordHash = null` has not been
claimed yet; it can only be claimed with the household key. Passkeys and device
credentials are additional sign-in methods, never a replacement for the
password.

## Behaviour

### Account list and sign-in

- The launch screen lists profiles by name and colour, plus a **Sign in** action
  for a chosen profile. It does not list password hashes, passkeys or roles.
- Choosing a profile asks for that profile's password. The sentence never says
  whether the profile exists: an unknown id and a wrong password both answer
  `401 incorrect_password`.
- A successful password sign-in creates a profile session. The response carries
  the profile (id, name, role, colour) and a token. The web also gets an
  HttpOnly `house_session` cookie.
- The old household form remains available only when `APP_PASSWORD` is set. It
  creates a break-glass admin session with no profile, and is used for claiming
  and recovery. It is not shown as the normal way in.
- On a fresh install with no passwords set, the first-run screen explains that
  an admin must claim `admin` with the household key, or that the household key
  can be used to set each profile's first password.
- The account list is public. That is deliberate: a person has to know which
  profile to sign in as, and the names are already visible on the profile
  screen. It exposes no secrets.

### Claiming a profile

`POST /api/auth/claim` takes `{ profileId, householdPassword, newPassword }`.

- The household password is checked with the same timing-safe comparison as the
  break-glass login.
- The profile must have no password. A profile that already has one answers
  `409 claim_unavailable`, even to an admin.
- The new password follows the policy below, is hashed with scrypt, and the
  profile is signed in.
- Claiming is the only place a normal person ever types the household key. After
  that, their password is the way in.

An admin can also set a member's first password with `POST
/api/auth/accounts/:id/reset`, without knowing the member's old password. That
is the normal setup path for a household that does not want to share the
household key.

### Password policy

- 8–128 characters, counted as Unicode code points.
- Rejected if it equals the profile name, case-insensitively, or is one of the
  small common-password list in the server (for example `password`,
  `12345678`, `qwertyui`).
- `password_too_short` carries `{ minLength: 8 }`; `password_too_long` carries
  `{ maxLength: 128 }`; `password_too_weak` carries `{ reason }` with a short
  code, not prose.
- The server never logs the password. The client never stores the password; it
  stores a derived key only inside the encrypted-cache envelope.

### Sessions

- A session row stores `id`, `tokenHash` (SHA-256 of the raw token), optional
  `profileId` (null for break-glass), `via` (`profile`, `household` or
  `device`), `userAgent`, `deviceLabel`, `createdAt`, `lastUsedAt`,
  `expiresAt` and `revokedAt`.
- Raw tokens are 32 random bytes, base64url-encoded. The raw token is returned
  once; the database never has it.
- Lifetime is 30 days, sliding on use, capped at 90 days from creation.
  `lastUsedAt` is written at most once an hour to avoid a write per request.
- A profile session resolves its profile from the session. `x-profile-id` is
  ignored. A break-glass session has no profile and may use `x-profile-id`
  during the migration; this is an admin capability and is removed once every
  client signs in per profile.
- `GET /api/auth/session` returns the current profile (or the break-glass flag),
  role and expiry. It is how the client decides whether to show the lock screen.
- `GET /api/auth/sessions` lists the caller's sessions with a device label,
  creation time, last use and a `current` marker. `DELETE
  /api/auth/sessions/:id` revokes one; `POST /api/auth/logout` revokes the
  current one.
- Password change revokes every other session for that profile. Admin reset
  revokes every session and device credential for that profile.
- Expired and revoked rows are deleted by a best-effort cleanup on login and at
  startup. Deleting them is not required for correctness.

### Changing and resetting passwords

- `POST /api/auth/password` takes `{ currentPassword, newPassword }`, verifies
  the current one, applies the policy, updates `passwordHash` and
  `passwordUpdatedAt`, and revokes every other session. The calling session
  stays valid.
- `POST /api/auth/accounts/:id/reset` is admin-only, takes `{ newPassword }`,
  and does not require the old password. It clears the lockout, revokes all
  sessions and device credentials, and leaves passkeys in place. A passkey is
  not a password; the profile can still use it, and the next password sign-in
  uses the new password.
- `POST /api/auth/accounts/:id/unlock` is admin-only and clears a lockout
  without changing the password.
- A reset cannot reach an offline cache on a device that never comes online.
  That limitation is stated in the UI and in `LIMITATIONS.md`.

### Login rate limiting and lockout

- Five consecutive failures in fifteen minutes lock the profile for 30 seconds.
  Every further failure doubles the lock: 1 minute, 2, 4, 8, 15 maximum. A
  successful login clears the counter.
- `429 account_locked` carries `{ retryAfterSeconds }` and a `Retry-After`
  header. The client renders the wait, not a raw number.
- A per-IP limiter (20 failures per ten minutes) also applies to unknown
  profiles and the household key, so guessing does not get a free run.
- Unknown profiles perform a dummy scrypt verification and answer
  `incorrect_password`; they do not reveal whether the profile exists.

### Web passkeys (Windows Hello)

- Registration requires an authenticated profile session and a password
  re-entry? **No:** the session is enough; the passkey is additive and cannot
  read data without a session. The settings screen still shows it as a security
  action and lists the existing passkeys.
- `POST /api/auth/passkeys/register/options` returns creation options with
  `rp.id = WEBAUTHN_RP_ID`, `rp.name = "Bookle"`, `user.name = profile.name`,
  `user.displayName = profile.name`, `authenticatorSelection` with
  `authenticatorAttachment: "platform"`, `userVerification: "required"`,
  `residentKey: "preferred"`, and attestation `"none"`.
- `POST /api/auth/passkeys/register/verify` verifies the attestation against the
  stored challenge, stores the credential id, public key, counter, transports
  and backup flag, and returns the credential label. The label defaults to
  "Windows Hello" on Windows and "Passkey" elsewhere; the client may send one.
- `POST /api/auth/passkeys/login/options` takes an optional `profileId`. With a
  profile it returns `allowCredentials` for that profile; without one it asks
  for a discoverable credential. The challenge is stored with a five-minute
  expiry and consumed once.
- `POST /api/auth/passkeys/login/verify` verifies the assertion, checks the
  stored counter for clone detection, updates `counter` and `lastUsedAt`, and
  creates a profile session. The credential's profile is the session's profile.
- `GET /api/auth/passkeys` lists the caller's credentials (label, created,
  last used). `DELETE /api/auth/passkeys/:id` removes one.
- Passkeys are hidden when `WEBAUTHN_RP_ID` or `WEBAUTHN_ORIGIN` is unset, or
  when the page is not a secure context. The server answers `503
  passkey_not_configured` rather than pretending.
- The ceremony is bound to `WEBAUTHN_ORIGIN`; a mismatch is a verification
  failure, not a warning. The server rejects a credential id that belongs to a
  different profile.
- The Android app does not import the passkey module. A browser on Android may
  still use the web passkey UI; that is additive and not the app's path.
- Windows Hello follows the Windows user. A shared Windows login shares the
  passkey store; the docs say to use separate Windows accounts for separate
  people.

### Android biometric unlock

- After a successful password sign-in, the app offers **Unlock with
  fingerprint or face**. Enabling it calls `POST /api/auth/devices` with a
  label (for example "Pixel 4a"); the server returns a random device secret
  once and stores only its SHA-256 hash, with a 90-day expiry.
- The app stores the device secret **and the profile's DEK** in a
  biometric-protected Vault. The Vault is the only place they are kept at rest;
  they are never in `localStorage` or plain IndexedDB.
- On launch/resume the app checks whether the Vault is available. If it is, the
  OS prompt runs. On success the app exchanges the device secret at `POST
  /api/auth/devices/session` for a normal profile session. If the server cannot
  be reached, the Vault's DEK unlocks the offline cache instead; the app stays
  offline and does not invent a session.
- Cancelling the prompt, a biometric lockout, an unavailable sensor, a changed
  enrolment or a revoked device credential falls back to the password screen.
  The password field is always visible; biometrics never traps a person.
- `GET /api/auth/devices` lists the caller's device credentials; `DELETE
  /api/auth/devices/:id` revokes one. A reset revokes all of them.
- The device credential is device-level. On a shared phone it proves the phone's
  biometric, not which profile is using it. The profile password remains the
  privacy boundary, and the UI says so.
- The app locks on background after the configured idle period (default 5
  minutes), clearing the in-memory session and DEK. Returning requires the
  biometric or password. Locking is a local sign-out: the server session is
  revoked when the app can reach it, and the device credential is what makes
  the next unlock quick.

### Offline cache encryption

- On first password sign-in, the client generates a random 32-byte DEK for the
  profile. It derives a KEK from the password with `scrypt` (random 16-byte
  salt, N=32768, r=8, p=1, 32-byte key) and wraps the DEK with AES-256-GCM. The
  envelope is stored in IndexedDB with a version, salt, IV and authentication
  tag. The AAD includes the profile id and envelope version.
- The DEK encrypts the private rows for that profile: `ListeningHistory`,
  `PlaySession`, favourites, wishlist, library membership and recent searches.
  Each row is encrypted as a whole JSON value with its own IV and AAD naming the
  table and row key. Shared metadata, covers and audio remain plaintext.
- The key is held in memory only while the profile is unlocked. A page reload,
  app restart or explicit **Lock** clears it.
- Offline sign-in asks for the profile password, derives the KEK, unwraps the
  DEK and authenticates the cache. A wrong password fails AES-GCM and shows the
  same "that password doesn't match" sentence; it does not delete data.
- If the profile has no local envelope (new device, cleared storage), offline
  sign-in says there is nothing cached on this device and offers the password
  form only when the server is reachable. It does not create a fake empty
  profile.
- Changing the password re-wraps the DEK with the new KEK; the data is not
  re-encrypted. Admin reset cannot re-wrap a cache on a device that is offline;
  when that device next contacts the server it is signed out, and the client
  deletes the private cache rather than leaving it under the old password. The
  UI warns before a reset.
- Android biometrics stores the DEK in the Vault, so the prompt unlocks the
  cache without the password. Forgetting the password while offline makes the
  cache unreadable; an online admin reset plus a re-sync is the recovery path.

### Locking and switching profiles

- **Lock** clears the in-memory DEK, hides the app behind the account picker,
  and revokes the current session when the server is reachable. Unlocking is a
  fresh sign-in: password, Windows Hello passkey on the web, or fingerprint/face
  on Android.
- **Switch profile** is a lock plus choosing another profile. There is no
  password-less switching between profiles.
- The web's HttpOnly cookie cannot be cleared from script on lock if the network
  is down; the client therefore treats the local lock as authoritative and
  refuses to render data until a fresh sign-in succeeds. The stale cookie is
  revoked on the next successful contact.
- On Android, the session token lives in the Vault or in memory, never in
  `localStorage`.

## Data model

Additive migration; no column is removed or repurposed.

```prisma
model Profile {
  // existing fields...
  passwordHash      String?
  passwordUpdatedAt DateTime?
  role              String    @default("member") // admin | member
  disabled          Boolean   @default(false)
  failedLoginCount  Int       @default(0)
  lockedUntil       DateTime?
  lastLoginAt       DateTime?

  sessions            Session[]
  deviceCredentials   DeviceCredential[]
  webauthnCredentials WebAuthnCredential[]
  webauthnChallenges  WebAuthnChallenge[]
}

model Session {
  id          String    @id
  tokenHash   String    @unique
  profileId   Int?
  via         String    // profile | household | device
  userAgent   String?
  deviceLabel String?
  createdAt   DateTime  @default(now())
  lastUsedAt  DateTime  @default(now())
  expiresAt   DateTime
  revokedAt   DateTime?

  profile Profile? @relation(fields: [profileId], references: [id], onDelete: Cascade)

  @@index([profileId])
  @@index([expiresAt])
}

model DeviceCredential {
  id          String    @id
  profileId   Int
  secretHash  String    @unique
  label       String?
  createdAt   DateTime  @default(now())
  lastUsedAt  DateTime?
  expiresAt   DateTime
  revokedAt   DateTime?

  profile Profile @relation(fields: [profileId], references: [id], onDelete: Cascade)

  @@index([profileId])
}

model WebAuthnCredential {
  id           String    @id
  profileId    Int
  credentialId String    @unique // base64url
  publicKey    String    // base64url
  counter      Int       @default(0)
  transports   String?   // JSON array
  backedUp     Boolean   @default(false)
  label        String?
  createdAt    DateTime  @default(now())
  lastUsedAt   DateTime?

  profile Profile @relation(fields: [profileId], references: [id], onDelete: Cascade)

  @@index([profileId])
}

model WebAuthnChallenge {
  id        String   @id
  profileId Int?
  challenge String   @unique
  type      String   // registration | authentication
  createdAt DateTime @default(now())
  expiresAt DateTime

  profile Profile? @relation(fields: [profileId], references: [id], onDelete: Cascade)

  @@index([expiresAt])
}
```

`Session.profileId` is nullable only for the break-glass session. A device or
passkey session always has a profile.

## API

Public (no session):

- `GET /api/health`
- `POST /api/auth/login` — `{ password }` is break-glass; `{ profileId,
  password }` is a profile sign-in.
- `POST /api/auth/claim`
- `GET /api/auth/accounts` — id, name, colour, role, `hasPassword`, `hasPasskey`
- `POST /api/auth/passkeys/login/options`
- `POST /api/auth/passkeys/login/verify`
- `POST /api/auth/devices/session`

Authenticated:

- `GET /api/auth/session`
- `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id`
- `POST /api/auth/logout`
- `POST /api/auth/password`
- `GET/POST/DELETE /api/auth/passkeys...`
- `GET/POST/DELETE /api/auth/devices...`
- `GET /api/auth/devices/session` is replaced by the exchange above; there is no
  second unauthenticated read.

Admin only:

- `POST /api/auth/accounts/:id/reset`
- `POST /api/auth/accounts/:id/unlock`
- existing scan, enrichment, taxonomy, library-root and profile-management
  routes.

The auth gate applies to `/api/` only. Static client assets and the SPA fallback
stay public: the login screen has to load before there is a session. This also
fixes a latent production bug where the first request for `/` was answered 401.

## Error codes

Added to `server/src/http-errors.ts` and mapped in `client/src/lib/apiError.ts`:

| Code | Status | Meaning |
|---|---|---|
| `account_locked` | 429 | Too many failures; `retryAfterSeconds` |
| `account_disabled` | 403 | Admin disabled the profile |
| `password_too_short` | 400 | `minLength` |
| `password_too_long` | 400 | `maxLength` |
| `password_too_weak` | 400 | `reason` |
| `claim_unavailable` | 409 | Profile already has a password |
| `profile_unclaimed` | 409 | Profile has no password yet; claim it with the household key or an admin reset |
| `session_not_found` | 404 | Session id is not the caller's |
| `passkey_not_configured` | 503 | `WEBAUTHN_*` unset |
| `passkey_failed` | 401 | Ceremony verification failed |
| `passkey_not_found` | 404 | Credential id is unknown or not the caller's |
| `device_not_found` | 404 | Device credential unknown or revoked |
| `device_auth_failed` | 401 | Device secret is wrong or expired |

`incorrect_password`, `auth_required`, `forbidden`, `profile_required` and
`request_invalid` keep their existing meanings.

## Security rules

- All route inputs use Fastify schemas. No raw `request.body`.
- Passwords are never logged, echoed in errors, or included in session payloads.
- Tokens and device secrets are compared by SHA-256 hash lookup, not by raw
  equality in application code. Password verification uses `timingSafeEqual`.
- The web cookie is `HttpOnly`, `SameSite=Lax`, `Secure` when served over HTTPS;
  the Caddy deployment sets `COOKIE_SECURE=true`. The Android header path stays
  because the app is cross-scheme.
- Media URLs get a short-lived signed token (five minutes, profile-bound)
  instead of the session token. The session token must not appear in access
  logs or browser history.
- CORS adds `https://books.home.arpa` and keeps the existing Capacitor origins.
  No wildcard with credentials.
- WebAuthn verifies `origin`, `rpIdHash`, `type`, `challenge`, `userPresent`,
  `userVerified`, and the credential's public key. Counter regression is a
  clone signal: the credential is rejected and the profile is asked to
  re-register.
- Admin routes check the role from the session, never from a header or body.
- A member cannot use `x-profile-id` to escape their session. The server returns
  their own rows even when the header names another profile.
- The library-root guard is unchanged: IDs from the client, paths resolved on
  the server and confined to configured roots.

## Migration

1. Add the nullable `Profile` auth columns and the four tables.
2. Set `role = 'admin'` for `admin`, `admin-test` and the existing `Testing`.
3. Rename existing `Playwright` to `test` and existing `Testing` to `admin-test`
   when the target name is free. If the target already exists, leave both; no
   data is deleted.
4. Insert `admin` if it does not exist, with `followsServerLibrary = true`, and
   give it every existing book only if it has no library entries.
5. Leave every other profile as `member` with `followsServerLibrary` unchanged.
6. Do not seed `Archie` on a fresh install; keep the row if it already exists.

On a fresh database, seed `admin`, `ben`, `dad`, `mum` with no password, plus
`test` and `admin-test` only when `SEED_TEST_ACCOUNTS=true`. When test seeding
is on, read `TEST_PROFILE_PASSWORD` and `ADMIN_TEST_PROFILE_PASSWORD` from the
environment and hash them; if either is missing, create the profile unclaimed
rather than inventing a password.

The migration must run under `prisma migrate deploy`, not `db push`, and must be
checked against a copy of the live database before it is applied.

## Copy

- The listener vocabulary is **profile**, **password**, **passkey**,
  **fingerprint**, **face**, **locked**, **signed in**. "Account", "user" and
  "member" do not appear in listener-facing strings; `member` is a server role,
  not a word on screen.
- New strings live in `client/src/copy.ts`, including:
  - `login` — heading, intro, profile password label, wrong password, locked
    sentence with wait, break-glass disclosure;
  - `profile` — claimed/unclaimed states, "Set up this profile";
  - `security` — passkey add/remove/list, Windows Hello helper, device unlock,
    signed-in devices, lock;
  - `offline` — "Enter your password to open this profile offline", wrong
    password, no cache on this device, reset warning;
  - `errors` — the new API codes.
- The existing `copy.login.wrongPassword` stays the one sentence for a wrong
  password, online or offline. The checker must stay at 0 errors; new warnings
  need a reason.

## Acceptance criteria

- [x] `Profile` has a password hash and a role; a profile with no password is
      claimable only with the household key.
- [x] An 8-character password is accepted; 7 and 129 are rejected with the
      documented codes.
- [x] `POST /api/auth/login` with a profile id and password creates a profile
      session; the profile is derived from the session, not the header.
- [x] A member session that sends another profile's `x-profile-id` still reads
      and writes only its own progress, favourites, wishlist and library.
- [x] A member gets 403 on scan, enrichment, taxonomy, library-root and
      profile-management routes; an admin gets through.
- [x] `APP_PASSWORD` still creates an admin break-glass session and can claim an
      unclaimed profile; normal profile login never asks for it.
- [x] Five wrong passwords lock the profile; the lock doubles; a correct
      password clears it; an admin can unlock it.
- [x] An unknown profile and a wrong password answer identically.
- [x] `GET /api/auth/sessions` lists the caller's sessions; revoking one makes
      its token fail with `auth_required`.
- [x] Session settings list active sessions with safe device labels and allow
      revoking other sessions.
- [x] Password change verifies the old password, revokes other sessions, and
      leaves the current session valid.
- [x] Admin reset changes the password, clears lockout, and revokes sessions and
      device credentials.
- [x] Static `/` and `/assets/*` load without a session; `/api/audiobooks`
      still answers 401 without one.
- [x] Existing data survives the migration: `Playwright` becomes `test`,
      `Testing` becomes `admin-test`, and `Archie` remains if present.
- [x] A fresh database seeds `admin`, `ben`, `dad`, `mum` and no known test
      password in production.
- [x] A web passkey can be registered with a virtual authenticator and used to
      sign in; a mismatched origin fails.
- [x] Passkey controls are hidden and the server answers
      `passkey_not_configured` when `WEBAUTHN_*` is unset.
- [x] Android fingerprint/face unlock exchanges a device credential for a
      session; cancelling falls back to the password.
- [x] A device credential can be revoked, after which the exchange fails with
      `device_auth_failed`.
- [x] The offline cache is unreadable without the profile password; a wrong
      password fails authentication and deletes nothing.
- [x] Changing the password re-wraps the DEK without re-encrypting rows.
- [x] Shared metadata, covers and audio stay readable offline; private rows do
      not.
- [x] Locking clears the in-memory key and requires a fresh sign-in.
- [ ] Caddy serves `https://books.home.arpa` with its local CA trusted on
      Windows; Windows Hello works there.
- [x] Android media requests use five-minute, profile- and resource-scoped
      tokens rather than placing the long-lived session token in media URLs.
- [x] The full server and client suites pass, `check-copy` is clean, and the
      Playwright suite includes the passkey and profile-isolation cases.

## Manual checks

1. **Windows.** Install the Caddy root CA, open `https://books.home.arpa`, sign
   in as `admin`, add a Windows Hello passkey, sign out, sign in with Windows
   Hello, remove the passkey, and confirm the password still works. Repeat with
   a second Windows user and confirm the passkey is not shared.
2. **Android (Pixel 4a, Android 13).** Sign in with a password, enable
   fingerprint unlock, background the app for six minutes, unlock with the
   fingerprint, cancel once and use the password, then revoke the device in
   Settings and confirm the next unlock falls back.
3. **Android (Motorola Defy, Android 11).** Repeat the biometric checks; if the
   sensor or Vault is unavailable, confirm the password path is the only path
   and does not crash.
4. **Offline.** Download a book, sign out, stop the server, sign in with the
   password, confirm progress and library are there, then try a wrong password
   and confirm nothing is lost.
5. **Migration.** Run `prisma migrate deploy` against a copy of the live
   database; confirm `Playwright`/`Testing` are renamed, `Archie` is intact, and
   every profile still sees the same library it did before.
6. **Break-glass.** Unset all profile passwords in a scratch database, claim
   `admin` with `APP_PASSWORD`, then claim a member with the same key. Confirm a
   claimed profile rejects the key with `claim_unavailable`.

## Testing

- **Server unit:** `password.ts` (hash/verify, policy boundaries, weak list),
  session token/hash/expiry, rate-limit backoff, WebAuthn challenge one-time use
  (phase 4).
- **Server routes (Fastify `inject`, temp SQLite):** login profile/household,
  unknown profile equivalence, claim, change, reset, unlock, session list and
  revoke, profile isolation with a member session plus a forged header, role
  gates, public static/API gate, migration data assertions.
- **Client unit:** KEK/DEK wrap/unwrap, wrong-password failure deletes nothing,
  re-wrap on change, encrypted private rows vs plaintext shared rows, account
  picker and lock-screen copy, API error mapping.
- **E2E:** a profile signs in with a password and sees only its data; a member
  is refused an admin action; a virtual authenticator registers and signs in
  with a passkey; the old household path still works as break-glass.
- **Not automatable:** Windows Hello's real UI, Android's real sensor, and the
  Caddy CA install. These are the manual checks above.

## Phases

1. **Docs and schema.** This spec, ADR 016, roadmap, limitations, schema and
   additive migration.
2. **Server auth foundation.** scrypt, sessions in SQLite, login/claim/change/
   reset/unlock, rate limiting, auth gate, profile-derived identity, role gates,
   tests.
3. **Client accounts.** Account picker, profile sign-in, lock screen, session
   boot, break-glass fallback, copy, tests.
4. **Encrypted offline cache.** DEK/KEK envelope, private-row encryption,
   offline password unlock, re-wrap on change, tests.
5. **Android biometrics.** Vault + Biometrics, device credential enrollment and
   exchange, lifecycle lock, device testing.
6. **Web passkeys.** `@simplewebauthn/server`, options/verify routes, settings
   UI, virtual-authenticator E2E.
7. **HTTPS deployment.** Caddy, `books.home.arpa`, local CA docs, CORS and
   cookie settings, Windows Hello verification.
8. **Hardening and handoff.** Media tokens, session/device lists, copy review,
   `npm audit`, migration rehearsal, manual checks, limitations update.

## Not in this spec

- Remote access from outside the LAN. ADR 006 still stands; Caddy is for the
  LAN's HTTPS hostname, not an internet exposure.
- Encrypting downloaded audio. The audio is household content, already on a
  shared server; the private rows are the privacy boundary.
- A full identity provider, OAuth, LDAP or SSO. This is a household, not an
  organisation.
- Parental controls or per-book age gates. A member's library is a shelf, not a
  permission system.
- Remote wipe of an offline device. A reset signs a device out on next contact;
  it cannot reach a device that never comes back.
- Passkeys in the Android WebView. Native biometrics is the Android path.
- Windows Hello as a second factor beside the password. It is a sign-in method,
  not an additional factor on the same session.
