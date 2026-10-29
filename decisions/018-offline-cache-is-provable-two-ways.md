# ADR 018 — A device's cache is provable two ways, and offline never dead-ends

## Status

Accepted (2026-10-29). Supersedes the "cache exists iff an envelope exists" rule
that `d5db2df` introduced and `47b38df` reverted; it also replaces the offline
ladder in `App.tsx` with a tested table.

Implemented by [`specs/29-offline-resilience.md`](../specs/29-offline-resilience.md)
and `client/src/lib/offlineGate.ts` + `client/src/lib/biometricFailure.ts`.

## Context

Offline, the app has to answer two questions before it can show anything:

1. **Does this device hold the profile's key?** Without it, private rows
   (progress, favourites) cannot be read. The books can still play.
2. **What is on the device?** The replica read is asynchronous and can fail.

The code answered (1) by checking `keyEnvelopes` only, and answered (2) by
swallowing the error and treating it as an empty library. Both answers were
wrong in a way that looked like data loss:

- **A fingerprint sign-in writes no envelope.** The native Vault stores the DEK
  directly; there is no password to derive a wrapping key from. So a listener
  who signed in with a fingerprint was told the device had "downloads but no
  protected profile data" while the books and the key were both present.
- **A failed replica read looked like an empty device.** "Nothing has been
  downloaded to this phone yet" was shown to someone holding several books.

And one more, which is why this is an ADR rather than a patch: `OfflineUnlock`
had **no exit**. The Keystore key is created with
`setInvalidatedByBiometricEnrollment(true)`, so enrolling a new fingerprint
permanently invalidates it while `hasSavedValue()` still returns `true`. Both
unlock paths could fail, and the only way out was force-quitting the app.

`d5db2df` tried to fix the first by making the unlock screen the answer to every
unprovable cache. It was reverted because it kept the dead end. `72b7ddb` fixed
the second (honest read failures) and is largely kept.

## Decision

**1. A cache is present when the envelope *or* the native Vault holds a key.**

```
offlineCacheState(hasEnvelope, vaultSaved) -> "present" | "absent"
```

"Present" means "there is something to unlock", not "unlocked". A DEK still has
to enter memory before private rows can be read, and that remains a separate
piece of state.

**2. Every offline screen has at least one action that leaves it.**

- The unlock screen always offers **Change server address** and **Listen without
  progress**, so an unusable saved key is annoying rather than terminal.
- The read-failure notice offers **Try again** (re-probe *and* re-read) and
  **Change server address**.
- The empty offline shelf offers both of those, and keeps Settings reachable.
- Zero books, no profile, absent cache: none of these produce `unlock`; they
  produce the shell with progress off.

**3. The offline decision is a pure, tested table.**

`offlineScreen()` returns `waiting | libraryReadFailed | unlock | shell`. One
test per row. The branch in `App.tsx` renders its answer and does not add
conditions of its own.

**4. Only an unusable key is discarded.**

`classifyBiometricFailure()` distinguishes cancellation, lockout, a missing
sensor, a transient OS failure and an invalidated key. Only `key-invalid` clears
the saved value. A value belonging to another profile is valid and is never
cleared; the listener is told which account owns it.

**5. Orphaned audio is adopted, not guessed at.**

Recovery lists `books/`, takes numeric directory names the replica does not
know, and asks the server what each one is (`GET /api/audiobooks/:id`). Files
are adopted only when they match that book's real track ids. A 404 or a folder
with no matches is reported and left untouched.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| **Always show the unlock screen offline** (`d5db2df`) | Traps a phone whose saved key is invalidated, and asks for a password when there is nothing to unlock. This is the regression that caused the revert. |
| **Never unlock offline; go straight to the shelf** | Progress and favourites disappear with no explanation, and the first listening session on every device silently loses its place. |
| **Treat an absent/Vault-only cache as "locked forever"** | Invents a dead end. The Vault key is a real key; the shelf works without progress. |
| **Auto-recover orphaned files in the background** | An invisible storage repair on every launch, and no consent for rewriting the library. Keeping it a visible, one-tap action is what makes it safe. |
| **Recover from filenames alone** | Filenames do not reliably carry track ids or book identity; inventing a book from a folder would produce a shelf of broken entries. |
| **Clear any saved value whenever the prompt fails** | Destroys another profile's device sign-in on a shared phone, and discards a valid key after a simple cancellation. |

## Consequences

- A listener can always get into a phone that holds downloads, even when their
  key is unusable. The cost is that progress may not be saved, which the shell
  says plainly.
- An offline skip is not persisted, so a cold start asks once more. That is the
  point: unlocking is what restores progress, and asking once per session is not
  nagging.
- Recovery restores **audio and catalogue metadata**, not the old private rows.
  Progress and favourites from before an origin change are not recoverable, and
  `LIMITATIONS.md` says so.
- The Kotlin/Java side must keep sending stable error codes. The numeric
  androidx code and the human message stay in the string as a fallback for
  older APKs.
