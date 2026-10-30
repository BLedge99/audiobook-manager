# ADR 011 — Audnexus has no book search; it is an ASIN-keyed lookup

## Status
Accepted (supersedes part of ADR 008)

## Context
ADR 008 put Audnexus first in the provider chain for "commercial" audiobooks,
searched by title and author. Spec 21 required its chapter titles, and pulling
that apart exposed that **the provider had never worked**.

Every Audnexus request in the spec 16 implementation returned HTTP 404. That
went unnoticed because the provider degrades silently — `search()` returns `[]`
on a non-OK response, and spec 16 explicitly requires that one provider failing
never fails an item. The symptom was invisible: the library still enriched
from LibriVox and Open Library, so it looked like the chain was working while
half of it was dead.

The real API:

- Base host is **`api.audnex.us`**, not `audnex.us`.
- There is **no book-search endpoint**. The public API exposes only:
  - `GET /authors?name=…` — find authors *by name*
  - `GET /authors/{ASIN}`
  - `GET /books/{ASIN}` — by id, not by title
  - `GET /books/{ASIN}/chapters` — **free, no token required**
  - `GET /health`
- The chapters endpoint additionally does *not* need the `ADP_TOKEN` that the
  project's own research notes assumed.

## Decision
1. Correct the host to `api.audnex.us`.
2. **Remove Audnexus from the title-driven search chain.** It cannot search by
   title, so it has nothing to contribute there. Leaving it in the chain only
   costs a wasted request per book.
3. Keep Audnexus as an **ASIN-keyed lookup** used for:
   - full book metadata, when we already hold an ASIN; and
   - **official chapter titles** (`/books/{ASIN}/chapters`), which is how
     single-file M4B books get chapter names.
4. Extract the ASIN from the file path. Audible rips routinely carry it in the
   filename and it is the only key that endpoint accepts.

## Alternatives considered
- **Self-host Audnexus** (it publishes a Docker image) — would have exposed the
  real endpoints and removed the public-instance dependency, at the cost of
  another container to maintain. Deferred; the public API is free and
  token-free for what we need.
- **Keep Audnexus in the chain and accept the 404** — rejected: a request that
  can never succeed is pure cost, and it masked the failure.
- **Drop Audnexus entirely** — rejected: its chapters endpoint is the only free,
  token-free source of official chapter titles for commercial audiobooks.

## Consequences
- ADR 008's "Audnexus first for commercial titles" is wrong and is superseded
  by this ADR. The *rest* of ADR 008 stands: LibriVox for public-domain
  recordings, Google Books and Open Library as gap-fillers.
- The silent-degradation requirement in spec 16 is unchanged and still correct
  — it is what makes a provider outage invisible, which is exactly how this one
  went unnoticed for an entire feature.
- **A test now asserts the host.** A regression that reintroduces the wrong
  base URL fails the suite instead of 404ing quietly.
- ASIN extraction is filename-only. A book whose ASIN lives in an atom and not
  the filename will not get Audnexus chapters. No M4B fixture exists in `test/`
  to verify that path, so it is documented as unverified rather than claimed.