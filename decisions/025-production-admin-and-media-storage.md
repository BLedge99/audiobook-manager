# ADR 025 — Expose the operator panel through the web port and keep audio in private object storage

## Status

Accepted 2026-11-05. Extends ADR 022 for the hosted Render deployment and adds
the production media path. Spec: [`specs/34-production-book-uploads.md`](../specs/34-production-book-uploads.md).
For hosted Render only, this supersedes ADR 022's statement that the public
listener has no admin paths; the listener proxies only to the loopback admin
app and does not host admin handlers itself.

## Context

The production Render service exposes one web port, while the admin panel listens
on its own port. The scanner and playback routes consume files by local path.
Uploading to a bucket alone therefore cannot populate the library, and keeping
the only copy on Render's ephemeral filesystem would lose the books on restart.

## Decision

- Keep the second Fastify admin listener and its separate route table, credential,
  and session as designed in ADR 022. The public listener proxies `/admin` and
  `/api/admin/*` only to a configured loopback admin target; it does not duplicate
  admin routes or authorize them with family accounts.
- Use a private Supabase Storage bucket as durable source media. The service-role
  key remains server-only. Browser uploads use short-lived, per-object signed
  upload URLs, issued only after admin authentication and server validation.
- Materialize bucket objects to a configurable server-local cache, then use the
  existing library root, scanner, and enrichment mechanisms. Rebuild that cache
  at startup because Render's filesystem is not the durable store.
- Keep the local admin port/listener usable for local development and do not
  change the scanner's path-based media model.

## Alternatives considered

- **Expose the admin port directly on Render.** Not available as the single
  public web-service port and would require a second deployment service.
- **Move admin handlers into the public app.** Rejected because it removes the
  route-table separation that protects the family listener (ADR 022).
- **Store audio in PostgreSQL.** Rejected: the database quota is separate from
  file storage, and audio blobs would consume database capacity and complicate
  scanner/playback access.
- **Stream bucket objects directly for every scan and playback.** Rejected for
  the initial implementation because scanner and media-token code are already
  local-path based; a cache preserves tested behavior.

## Consequences

- The main listener exposes only the narrow proxy paths and forwards them to
  the existing admin app. Admin auth remains enforced by that app.
- Supabase Storage and Render cache settings are deployment requirements; the
  cache must have enough available disk to hold the synchronized library.
- Startup sync is repeatable and non-destructive. Sync failures are logged and
  surfaced to the operator; source objects are never deleted automatically.
- Tests cover the proxy boundary and path validation as well as storage API
  behavior.
