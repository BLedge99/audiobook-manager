# Spec 11 — Security Hardening & Testing

## Purpose

The server exposes filesystem-adjacent endpoints. This spec defines the
defensive requirements and the automated security test suite.

## Requirements (must hold)

1. **No client-supplied paths.** Streams and covers are fetched by ID; the
   server resolves `MediaItem.filePath` / `Track.filePath` from the DB.
2. **Root confinement.** Before any read, resolve the real path and assert it
   starts with a configured `LibraryRoot` path. Reject `..`, encoded
   traversal (`%2e%2e`, `..%2f`), absolute client paths, and symlink escapes.
3. **Validated input everywhere.** Fastify JSON schemas on all routes; 400 on
   missing/invalid params; bounded `:id` integers.
4. **Range requests bounded.** Malformed ranges → 416; never stream unbounded.
5. **Error hygiene.** API errors don't leak absolute host paths or stack traces.
6. **CORS limited** to the client origin(s).
7. **Auth readiness.** Session gate (spec 03) wraps all routes; default
   deployment is LAN-only with the household password.
8. **Dependencies.** `npm audit` run and triaged on changes; no unmaintained
   media parsers without a documented reason.

## Security test suite (runs as `playwright test --project=security` + a Vitest integration group)

- Path traversal against `/api/audiobooks/:id/stream`, `/api/tracks/:id/stream`,
  `/api/audiobooks/:id/cover`: SQL-ID fuzzing, traversal payloads in params.
- Attempt to register/scan a library root outside allowed media dirs and confirm
  reads still confine to roots (or that such roots are rejected at setup).
- Malformed JSON bodies, wrong types, missing params on every route → 4xx, no crash.
- Range abuse: `bytes=-1`, `bytes=99999999999-`, reversed ranges → 416, no DoS.
- Auth: unauthenticated request to every route → 401 once spec 03 lands.
- CORS: disallowed origin gets no ACAO header.
- Temp symlink inside a library root pointing to `/etc/passwd` is refused.

## Acceptance criteria

- [x] Every test above is automated and green.
- [x] Code review checklist item: "does this touch the filesystem? root-confined + tested?"
- [x] `npm audit` documented result in last change.

## Not in this spec

- Internet-facing TLS, WAF, penetration testing.
