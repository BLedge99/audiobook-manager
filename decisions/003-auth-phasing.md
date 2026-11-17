# ADR 003 — Auth phasing: shared household password, profiles first-class

## Status
Accepted 2026-09-22 — amended 2026-11 by ADR 016 (profiles are accounts: passkeys/biometrics) and ADR 023 (email/password + OAuth for the hosted demo). Per-profile credentials, biometrics and (demo-only) OAuth/email sign-in shipped; the "no per-user credentials" clause now applies only to the household deployment model.

## Context
The app will have multiple household users, but exposing full account management
early is wasted effort on a LAN-only deployment.

## Decision
- Per-user profiles are first-class (isolated progress/history) from the start.
- Access is gated by a single shared household password (env-configured), set
  up before any exposure beyond trusted LAN.
- No per-user credentials, email, or password reset flow until remote access
  arrives.

## Alternatives considered
- **No auth at all** — acceptable on a trusted home LAN but one stolen laptop
  away from open access; compromised later than done.
- **Full multi-user auth now** — disproportionate for household scale.

## Consequences
- Anyone with the household password can switch to any profile — accepted;
  progress isolation is about convenienece, not security.
- Session/cookie shape designed so real per-user auth can replace it later.
