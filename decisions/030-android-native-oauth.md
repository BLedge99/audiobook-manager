# ADR 030 — Native Android OAuth via Custom Tabs and a one-time handoff code

## Status

Accepted 2026-11-11. Extends ADR 023 and spec 32 (whose "Android out of scope"
lines this supersedes). Spec: [`specs/32-oauth-email-signin.md`](../specs/32-oauth-email-signin.md).
Code: [`docs/android-native-oauth-plan.md`](../docs/android-native-oauth-plan.md).

## Context

The production demo signs people in on the web with Google and GitHub OAuth
(ADR 023). The Android app ships the same buttons, and they cannot work:

- The app's WebView origin is `https://localhost`; `window.location.href =
  "/api/auth/google/authorize"` resolves there and the asset loader answers with
  the app shell — the shell reloads and the user lands back on the sign-in
  screen. The same defect exists in the demo-mode anchors.
- Google **blocks embedded user-agents for OAuth outright** (`403
  disallowed_useragent`), policy enforced since 2021 and echoed by Play
  Console's WebView-authentication remediation guidance. Any in-WebView consent
  page is dead on arrival.
- Even redirected to the production site inside the WebView, the session ends
  in a `SameSite=Lax` cookie on the server origin — which the native client
  never reads (native sessions travel as an in-memory `x-house-session` header;
  see `client/src/lib/api.ts`).

RFC 8252 (OAuth 2.0 for Native Apps) mandates an external user-agent for native
authorization requests and describes exactly this shape: the browser holds the
provider leg; a private-use URI scheme carries the response back into the app.

## Decision

The native flow keeps the existing server-side provider leg (PKCE S256 +
HttpOnly `oauth_state` / `oauth_code_verifier` cookies) and adds:

1. `GET /api/auth/:provider/authorize?client=native&state=<app-generated 128-bit
   state>` — like the web flow, plus a short-lived `oauth_app_state`
   HttpOnly cookie. No other provider-leg change; `redirect_uri` is unchanged.
2. On callback, native mode resolves the account exactly as the web flow does,
   but does **not** set `house_session`; it inserts one `OAuthHandoff` row —
   sha256(code), sha256(state), the resolved `profileId`, 60 s TTL — and 302s
   to `com.technative.audiobookmanager://oauth/callback?code=<code>&state=<state>`
   (or `…?auth_error=<code>` on failure).
3. The app (a `@capacitor/app` deep-link listener, backed by `@capacitor/browser`
   for the Custom Tab) verifies the scheme/host/path and the in-flight `state`,
   then `POST`s `{ code, state }` to `POST /api/auth/oauth/handoff`, which
   atomically consumes the row and **mints the session at exchange time** via
   the same call the password sign-in uses. The app proceeds exactly as after a
   password sign-in.

Properties the design commits to: one-time code, 60 s TTL, sha256 at rest for
code and state, app-generated state re-verified server-side (RFC 8252 §8.9),
no token in the deep link or anywhere at rest, no embedded-user-agent code
path at all, household deployments without `OAUTH_*` unaffected.

## Consequences

- New additive table `OAuthHandoff` (both Prisma schemas), one new public
  endpoint, one new cookie (`oauth_app_state`), one new manifest
  `<intent-filter>`; new dependencies `@capacitor/app` and `@capacitor/browser`.
- The web flow is byte-for-byte unchanged; the web tests anchor that.
- GDPR: handoff rows carry only a pseudonymous `profileId`, live ≤60 s, and are
  swept at startup (`docs/roa.md` §2, `docs/retention.md` row 13).
- Device verification is honestly manual; Playwright cannot drive a Custom Tab.
  A1/A2/A3 remain unchecked until the device matrix runs.
- HTTPS App Links (the stronger, OS-verified delivery) is deliberately *not*
  taken now; it requires a TLS domain the LAN deployment doesn't have.
  See below.

## Alternatives considered

- **Embedded WebView OAuth** — prohibited by Google policy and by RFC 8252
  §8.12; also cannot seed the native session cookie. Rejected.
- **Pass the session token directly in the deep link** — constant exposition in
  URLs, app-switcher and logs; any previewer can replay it. One-time,
  state-bound, 60 s is the same threat class with a closed window and a proof
  requirement. Rejected.
- **HTTPS App Links** (`autoVerify` + `assetlinks.json`; RFC 8252 §7.2) — the
  mechanically stronger option, but needs a publicly valid TLS certificate for a
  domain we control, which the production demo has and plain-HTTP household
  servers do not. Deferred as a documented Phase 6 follow-up for the demo host;
  the custom scheme covers both worlds today.
- **Loopback redirect** (RFC 8252 §7.3) — a desktop-oriented pattern; a phone
  already has a browser hand-off. Rejected.
- **Full native OIDC SDK** — the demo audience signs in with already-designed
  web providers; re-shipping provider flows natively doubles the surface and
  the maintenance. Rejected; the browser is the correct consent surface.
- **Hide the OAuth buttons on Android** — honest but strands the demo's mobile
  audience without any path in. Rejected in favour of building the flow.
