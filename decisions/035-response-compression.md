# ADR 035 — Response compression lives in the app, not only at the edge

## Status

Accepted (2026-11-13).

## Context

Two deployment shapes serve this app today:

1. A single Fastify process on the home server (`Dockerfile.prod`), reached
   directly on `:3000` by the LAN, and
2. The same process behind Caddy (`Caddyfile`, `books.home.arpa`), which adds
   `encode zstd gzip`.

Until 2026-11 both were supposed to be fast; only the second actually
compressed anything. JSON (including the full-library response) and the built
bundle went over the wire uncompressed in the common case, and nothing
in-process negotiated `Content-Encoding` at all.

## Decision

`@fastify/compress` is registered in both listeners (family and admin), 1 KB
threshold, negotiated encodings `br`, `gzip`, `deflate`. Caddy keeps its own
`encode` for the edge deployment; it serves the same responses and passes
through `br`/`gzip` when the client accepts either. Static assets are not
precompressed into the repo; the edge-of-process compressor does it per
response with caching headers immutable for content-hashed `/assets/*`, which
is the only repeat traffic that benefits.

## Consequences

- A direct-to-`:3000` deployment is now compressed without any proxy.
- `br` is the negotiated default where the client supports it (browsers and
  the WebView both do); brotli level is zlib's default, which is fine for
  static-shaped bytes served from memory.
- Compression CPU cost lands in the server process; at household request
  volumes this is noise, and `@fastify/compress` skips already-encoded
  streams and small bodies.
- Routes stay agnostic of compression; no per-route decisions.

## Alternatives rejected

- **Caddy-only compression.** Correct for the LAN front door, silently absent
  for every other way this app is run. Rejected: the platform must not depend
  on the proxy being there.
- **Precompressed `.br`/`.gz` assets served with content negotiation.**
  Saves per-response CPU, costs build complexity and stale-asset risk for
  bytes that are already immutable-cached. Rejected for now; revisit if a
  real CPU ceiling shows up on a Pi deployment.
