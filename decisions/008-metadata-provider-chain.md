# ADR 008 — Adaptive metadata provider chain

## Status
Accepted, **partly superseded by ADR 011**

> **Superseded in part (see ADR 011).** Audnexus has no book-search endpoint and
> its host was wrong, so it never worked as the "commercial" entry in this
> chain. It has been removed from the title-driven search and is now an
> ASIN-keyed lookup used for chapter titles. Everything below about LibriVox
> detection, sequential walking and `METADATA_PROVIDER_ORDER` still stands.

## Context
Spec 07 enriches from Open Library and Google Books. Both are book-oriented,
neither knows who narrated an audiobook, neither has a reliable series number,
and neither will ever match a LibriVox recording of a public-domain title well.
Two free, key-less audiobook-native services fix most of that gap:

- **Audnexus** (`audnex.us`) — an audiobook metadata aggregation API. No auth,
  no hard quota on the public instance. Returns narrators, series + sequence,
  publisher, description, ASIN, genres (2 parent + up to 4 sub-genre), and
  covers up to 3200×3200. But it aggregates Audible's *commercial* catalogue.
- **LibriVox API** (`librivox.org/api/info`) — no auth, no quota. Returns
  authors, translators, genres, `copyright_year`, language, cover art, and
  critically `sections`: the per-file chapter list with a **reader** per
  section. But it only knows titles LibriVox produced.

The two fail in **disjoint** cases. Audnexus has no entry for a LibriVox
recording; LibriVox has no entry for a commercial Audible title. A fixed
provider order therefore wastes the first network call on roughly half of any
given library.

## Decision
Resolve provider priority **per item, from local evidence**, then walk the
chain sequentially and stop at the first match above the confidence threshold.

1. If the item looks like a LibriVox / public-domain recording → **LibriVox
   first, Audnexus second**.
2. Otherwise → **Audnexus first, LibriVox second**.
3. Then **Google Books**, then **Open Library**, as description/cover gap-fillers
   only. Neither contributes narrators or series.

Detection reads data we already hold and costs no network call: `librivox.org`
in the file path, `librivox` / `public domain` in the embedded artist or
description, or a LibriVox-style project folder name.

`METADATA_PROVIDER_ORDER` (comma-separated) overrides the resolved order
outright, so the heuristic can be corrected in deployment without a code
change.

Per-title contributor data (LibriVox section readers) is captured per `Track`,
which is more accurate than collapsing to one narrator string per book.

## Alternatives considered
- **Audnexus only** — best per-record quality, but blind to every LibriVox
  title. Silently halves coverage on a LibriVox-heavy library.
- **LibriVox only** — the inverse blindness; useless for a ripped
  Audible/EAC library.
- **Fixed order, Audnexus first** — simple, but wastes a call on every
  public-domain title and needs a manual flip for LibriVox-heavy libraries.
- **Query all four in parallel and merge** — marginally fewer round-trips, but
  4× the requests, 4× the dedup surface, and it discards the "stop when
  confident" behaviour that keeps a Pi's outbound load low.
- **Self-hosted Audnexus** — removes the public-instance dependency and the
  rate limit entirely, at the cost of another container to maintain. Deferred;
  the chain degrades correctly without it.

## Consequences
- Roughly halves network calls per book versus a fixed order.
- All four clients are independently optional; any one failing must not fail
  the item (see spec 16).
- The detection heuristic is a guess. It is cheap and overridable, but it is
  the most likely thing to need tuning against a real library.
- Neither Audnexus nor LibriVox is a recommendation service. See ADR 010.