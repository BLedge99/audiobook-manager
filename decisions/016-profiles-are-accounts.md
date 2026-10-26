# ADR 016 — Profiles are accounts: passkeys on the web, biometrics on the device

## Status

Accepted. Implements roadmap item 28 and user-testing finding 2. Supersedes the
shared-password auth model in `specs/03-profiles-and-auth.md`; it does not
supersede ADR 014 (the Android app keeps its HTTP LAN origin).

## Context

The app has profiles, but it does not have accounts. One household password
opens the app, `x-profile-id` names the profile, and the server trusts that
header. Anyone who knows the household password can read and write anyone's
progress, favourites, wishlist and library by changing one request header. That
is the privacy finding from real household use, and it is not fixable with a
PIN screen in front of the same trust model: the data is one request away.

The household asked for three things that pull in different directions:

- **A password-protected profile.** Each person should sign in as themselves,
  not as the household.
- **Windows Hello on the web.** The Windows front end should offer passkeys.
- **Fingerprint or face on Android.** The phone should unlock with the OS
  biometric prompt, not with a WebAuthn ceremony.

There are hard platform constraints behind those requests:

- WebAuthn needs a **secure context**. `https://` is one; `http://localhost` is
  also one, which is why development and Playwright can test passkeys before a
  home server has TLS.
- A WebAuthn **relying party is a hostname**, never an IP address. Passkeys
  cannot be enrolled on `http://192.168.1.203:3000`, and changing the hostname
  later would orphan every credential.
- Android's embedded WebView is not the passkey path. WebAuthn in a WebView is
  unreliable, and an APK served from `https://localhost` cannot be the relying
  party for a home server on another origin.
- Offline listening must still work. A password hash protects the server, not a
  local cache: a copied IndexedDB database can be read without the app. If the
  cache is private, it has to be encrypted.

## Decision

### 1. The profile is the account

There is no second `User` table. `Profile` gains the authentication fields and
one role, `admin` or `member`. A profile always has a password; passkeys and
biometrics are additional ways to obtain the same session, never the only way
in. This is what lets Android work without WebAuthn.

Passwords are 8–128 characters. The server hashes them with `node:crypto`'s
`scrypt` and stores the parameters with the hash, so the cost can be raised
later without a migration. There is no native hashing dependency to build on a
Raspberry Pi.

### 2. The session decides who the caller is

A normal profile session has a `profileId`, and the server uses it. The profile
session ignores `x-profile-id`; sending another profile's id returns the
caller's own data, not the other profile's.

`APP_PASSWORD` remains as the **break-glass/recovery** key. It creates a
household session with no profile, an `admin` role, and a flag saying it is a
break-glass session. It is the only way to claim a profile that has no password
yet, and the way back in when an admin password is lost. It is not a daily
second password for an admin: an admin signs in with their own password, and
the household key is not requested again.

During the migration, a break-glass session may still name a profile in
`x-profile-id`. That keeps the existing test suite and tooling working while the
client moves to profile sign-in. A profile session cannot do it. The allowance
is explicitly an admin capability, not a property of normal use, and the spec
records it as temporary.

### 3. Passkeys are additive and web-only

Windows Hello is a platform authenticator behind WebAuthn. Registration and
login live in the web client, use `authenticatorAttachment: "platform"`,
`userVerification: "required"` and attestation `"none"`. A passkey is stored per
profile and can be listed and removed in Settings → Security.

The feature is gated by `WEBAUTHN_RP_ID` and `WEBAUTHN_ORIGIN`. If either is
unset, the server reports passkeys as not configured and the client hides the
controls rather than offering a button that cannot work. The Android app imports
no passkey code and shows no passkey controls.

Production web passkeys need HTTPS at the real hostname. The deployment path is
Caddy with `tls internal` at `books.home.arpa`, with its local root CA installed
once on each Windows machine. The Android app continues to use
`http://<server>:3000`; it does not need TLS for biometrics.

### 4. Android biometrics is a local device unlock

The Android app does not use WebAuthn. After a password sign-in it asks the
server for a **device credential** — a random secret returned once and stored in
a biometric-protected Vault (Capawesome Vault + Biometrics, or the Aparajita
pair if Capacitor 8 compatibility requires it). On launch or resume the app
shows the OS fingerprint/face prompt, reads the secret from the Vault, and
exchanges it for a normal session.

This is device-level, not profile-level. It proves the person holding the phone
can pass the phone's biometric check; it does not prove which household profile
they are. The profile password remains the boundary for the profile's data,
which is why biometrics never replaces the password. Cancelling, a biometric
lockout, a changed enrolment or an unavailable sensor falls back to the password
screen, which is always visible.

### 5. Offline data is encrypted with a key the password unwraps

Each profile has a random data encryption key (DEK). The password derives a
key-encryption key (KEK) with `scrypt`; the KEK wraps the DEK with AES-GCM. The
unwrapped DEK encrypts the profile's private rows: progress, listening history,
favourites, wishlist, library membership and recent searches.

Shared catalogue metadata, covers, and downloaded audio stay unencrypted. They
are household library content, and encrypting gigabytes of audio buys nothing.
The spec says this plainly rather than claiming the device is fully encrypted.

A wrong password fails the AES-GCM authentication, so there is no separate local
password check to drift. Locking clears the in-memory key. Changing the password
re-wraps the DEK; it does not re-encrypt the data. Android's Vault stores the DEK
beside the device credential so fingerprint/face can unlock it without the
password.

An admin reset revokes sessions and device credentials, but it cannot erase an
offline cache on a device that never comes back online. A reset signs the
profile out everywhere on next contact; it is not a remote wipe. This is
recorded as a limitation, not hidden.

### 6. Sessions live in the database

Sessions are rows, not an in-memory `Set`: random 32-byte tokens, only a SHA-256
hash stored, a 30-day sliding expiry with a 90-day cap, revocation, and a
signed-in-devices list. The web uses an HttpOnly cookie; Android uses the
`x-house-session` header. A short-lived signed media token replaces the session
token in `<audio>` and image URLs.

Login failures are rate-limited per IP and per profile, with exponential
lockout. Unknown profiles take the same work and answer with the same
`incorrect_password` code as a wrong password.

### 7. Migration preserves history

The migration is additive and deletes no profile. Existing profiles get the
`member` role; `admin` and `admin-test` get `admin`. Existing `Playwright` is
renamed to `test`, and existing `Testing` to `admin-test`, preserving their ids
and history. `Archie` is kept if present but is not seeded on a fresh install.
No profile is deleted automatically.

On a fresh database the server seeds `admin`, `ben`, `dad` and `mum`; `test` and
`admin-test` are seeded only when test accounts are enabled, and their known
passwords come from the environment in development and CI only. A production
database never gets a known test password.

## Alternatives rejected

**Keep the shared household password and add a PIN screen.** The PIN would be
client-side theatre. The API would still accept the household token plus any
`x-profile-id`, so the data would remain one request away. A privacy feature has
to move the trust boundary, not cover it.

**A separate `User` table beside `Profile`.** It would duplicate the identity
every existing relation already points at (`ListeningHistory.profileId`,
`Favourite.profileId`, `WishlistItem.profileId`, `ProfileLibraryEntry.profileId`)
and require a data migration for no new capability. A profile with a password is
the account.

**Passkeys only, with no password.** Android cannot use a home-server passkey,
and losing a passkey would lock a person out of their own offline books. A
password is the recovery method every platform can use.

**WebAuthn inside the Android WebView.** The WebView origin is not the server's
origin, Android's credential providers are not reliably reachable from it, and a
credential bound to `localhost` would not work against a home server. Native
biometrics is the supported path on that platform.

**Use `192.168.1.203` as the relying party.** WebAuthn RP IDs are hostnames, not
addresses. Even if a browser accepted it, changing the address would invalidate
every passkey.

**Encrypt the whole client database with SQLCipher.** It is Android-only, adds a
large native dependency to the web build, and would encrypt shared catalogue
metadata and audio that do not need it. A per-profile DEK over the private rows
is smaller and portable.

**Require `APP_PASSWORD` for every admin sign-in.** It adds a second secret to
the daily flow without a real boundary: the admin can already reset members and
manage the library. It is a recovery key, not a second factor.

**Derive the offline key from the session token.** The session expires and is
revocable; the cache must survive a session ending. The password is the only
secret the person can reproduce offline.

**Keep the in-memory session `Set`.** It is already lost on restart, cannot be
revoked per device, and has no record of where a profile is signed in. The
database is authoritative for every other piece of state; sessions belong there
too.

## Consequences

- **One extra schema migration.** `Profile` gains auth fields; four tables are
  added (`Session`, `DeviceCredential`, `WebAuthnCredential`,
  `WebAuthnChallenge`). No column is removed or repurposed.
- **The API gets an account surface.** Login, claim, session, password change,
  reset, passkey and device routes are added; existing routes keep their paths.
- **The client gets an account picker and a lock flow.** The old household
  password screen remains as a fallback only where `APP_PASSWORD` is enabled.
- **Admin support can still choose a profile during the migration.** The
  `x-profile-id` allowance is limited to break-glass sessions and is removed
  once the client always signs in per profile. It is not a normal-user feature.
- **Windows Hello follows the Windows user.** A shared Windows login shares the
  passkey store. Separate Windows accounts are the privacy-preserving setup.
- **Android biometrics follows the device.** On a shared phone, the profile
  password is still the real boundary. Weak face unlock may not release a
  Keystore key; the OS falls back to fingerprint/PIN and the password works.
- **Offline privacy has a limit.** A device that stays offline after a password
  reset keeps its old cache. A stolen unlocked device is a device problem, not a
  server problem. Both are recorded in `LIMITATIONS.md`.
- **The web deployment grows Caddy.** The Pi needs ports 80/443 and a local CA
  installed on Windows machines. The app still runs on plain HTTP for Android
  and development, where passkeys are hidden.
- **Existing tests can keep signing in with the household key.** They do not
  exercise per-profile privacy until the new account tests land, so the spec
  requires both kinds of test rather than treating the old suite as proof.

## Verification

This ADR lands with `specs/28-accounts-passkeys-biometrics.md`. Verification is
recorded there as the phases complete:

- unit tests for password hashing, policy, sessions and rate limiting;
- route tests for login, claim, change, reset, session revocation and
  profile isolation;
- client tests for the encrypted cache and wrong-password failure;
- a Playwright virtual-authenticator passkey ceremony;
- manual Windows Hello enrollment and sign-in on Windows;
- manual fingerprint/face unlock on the Pixel 4a and the Motorola Defy;
- Caddy/TLS and CA-install verification on the Windows machines.
