# ADR 027 — The Android biometric gate stays a gate

## Status

Accepted (2026-11-11). Implements the prompt behaviour in
[`specs/36-device-identity-and-sessions.md`](../specs/36-device-identity-and-sessions.md),
which amends the Android section of
[`specs/28-accounts-passkeys-biometrics.md`](../specs/28-accounts-passkeys-biometrics.md).

## Context

Spec 28 set the Android sign-in as a *gate*: "On launch/resume the app checks
whether the Vault is available. If it is, the OS prompt runs", and "The device
credential is device-level. On a shared phone it proves the phone's biometric,
not which profile is using it. The profile password remains the privacy
boundary."

The Android session token is memory-only. That is not an oversight: the
WebView's origin is `https://localhost` and the API is `http://<lan-ip>:3000`,
so a `SameSite=Lax` cookie is never stored or sent, and the token has to be
carried in the `x-house-session` header instead. The consequence is that the
token dies with the process, so every cold start needs the prompt again.

That is the intended design. The problem it produced was different: the prompt
was followed by a call to `POST /api/auth/devices/session`, and that call
**inserted a new session row every time**. Thirty-odd sign-ins on one phone
became thirty-odd rows in the "Signed-in devices" panel.

So the complaint was "the app re-registers my phone every time", and there were
two ways to read it:

1. the *bookkeeping* is wrong, and the fix is to make a session belong to a
   device; or
2. the *prompt* is wrong, and the fix is to stop asking for it.

This ADR settles the second one.

## Decision

**The prompt stays.** A cold start on Android still asks for the fingerprint or
face, and the app still has no server session until it succeeds.

The pile-up is fixed on its own terms, in the session layer: a device credential
owns its session, and exchanging the device secret rotates the token on that
session instead of creating another one. One phone is one row.

The one behaviour that changes is a bug fix rather than a policy change: after
the five-minute background lock the app cleared its token but kept rendering as
signed in, so every request failed with a 401 and the app was unusable until
it was restarted. The lock now returns the app to the account gate, where the
prompt belongs.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| **Silent session restore** — keep the token in the Keystore under a key with `setUserAuthenticationRequired(false)` and restore it on launch without a prompt | It removes the boundary the product is built on. The session token grants API access to the profile's server-side progress, favourites and wishlist, so anyone holding an unlocked phone could read them. Spec 28 says the profile password is the privacy boundary and the phone's biometric proves the phone; silently restoring the session would make the second true and the first false. |
| **Device-credential gate** — same, but the Keystore key requires the phone's PIN/pattern (`AUTH_DEVICE_CREDENTIAL`) instead of a biometric | Still a silent restore for anyone who knows the PIN, and it swaps a prompt the listener knows for one they may not. The device credential is already the *proof* held by the phone; using it as the *unlock* would blur the two. |
| **Longer-lived in-memory token** — keep the token across app restarts in memory | Memory is exactly what a process restart clears. There is no version of this that survives without writing the token somewhere. |
| **Revoke the previous session on each new one** — keep inserting rows, but revoke the old one | It fixes the panel's row count and leaves the underlying mistake in place: a sign-in is not a device, and the session table would still record one row per sign-in for the life of the profile. It also makes the panel's "first signed in" date a lie. |

## Consequences

- A cold start on Android still asks for the fingerprint. That is the price of
  the boundary, and it is paid knowingly.
- The panel is now truthful: one row per device, with the date the device first
  signed in.
- The prompt no longer has a side effect on the server's data. It re-opens the
  device's own session, which is what a prompt on a device should do.
- If the household later decides the prompt is too frequent, this ADR is the
  thing to supersede — and the silent-restore alternative is written down here
  so that decision does not have to be re-derived from scratch.
