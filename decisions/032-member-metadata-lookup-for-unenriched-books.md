# ADR 032 — Members may trigger metadata lookup for books that are not yet enrichment-applied

> Supersedes the broad “enrichment is admin-only” reading in spec 28’s route-gating
> section, in favour of the scoped relaxation recorded in spec 28 (amended 2026-11-12).
> Builds on ADR 009 (precedence), ADR 016 (profiles are accounts).

## Context

Spec 28 makes a profile an account with an `admin`/`member` role, and treats
scans, library roots, enrichment, taxonomy/tag vocabulary and profile
management as operator (admin) surfaces. Enrichment is applied to the **shared
catalogue**, so a casual member action could have rewritten shared rows that an
operator had already handled or reviewed.

The cost of that blanket rule is that the in-app "Find metadata online" action,
the one a listener is most likely to reach for on a book missing metadata, was
invisible/unusable for members — even when the book had never been enriched
(`enrichmentStatus = null`/`pending`/`failed`/`skipped`/`review`) and running a
lookup is the exact same machine the background pass runs after a scan.

## Decision

A **member** may, for a single book, call:

- `POST /api/audiobooks/:id/enrich` — request lookup/auto-apply for that book
- `GET /api/audiobooks/:id/candidates` — read stored candidates for that book
- `POST /api/audiobooks/:id/metadata` with `candidateId` only — apply a known
  candidate for that book

**Only while** the book is **not yet enrichment-applied**, i.e.
`MediaItem.enrichmentStatus !== "applied"` (null, pending, review, skipped or
failed all qualify). Manual metadata edits without `candidateId` remain
admin-only. Everything else stays admin-only: bulk `POST /api/enrichment/run`,
exclusion `GET /api/enrichment/status` / `review-queue`, any
`/metadata/reset*` route, `PUT …/tags`, scans, library roots, taxonomy/tag
vocabulary and profile management.

The route handlers re-check the book’s `enrichmentStatus` on every member
request (no caching of eligibility), so a book that becomes `applied` between
render and click is refused with `403 forbidden`. Admins are unaffected.

## Alternatives rejected

1. **Keep enrichment fully admin-only.** Rejected: leaves the common case (a
   listener with a badly-tagged file that nothing has enriched yet) blocked,
   forcing an admin to run a lookup for one book on a shared server.
2. **Let members trigger lookup but never apply.** Rejected: a lookup that
   finds a high-confidence match must be able to auto-apply; otherwise members
   are left reviewing a queue they cannot see.
3. **Let members apply manual edits too.** Rejected: manual title/author/description
   /cover-URL edits are curation of the shared catalogue; a member must not
   unilaterally rewrite fields an admin manages by hand.

## Consequences

- Spec 28 is amended to state the member/admin split for these three routes.
- The gate (`server/src/auth/policy.ts`) stops forcing 403 for these three
  routes; handlers enforce `enrichmentStatus !== "applied"` for non-admins.
- The UI shows/hides the in-app lookup based on role and book state.
