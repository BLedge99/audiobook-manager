# ADR 010 — Recommendations are tag-similarity, not a recommender

## Status
Accepted

## Context
Spec 19 must surface "books like this one" and "more like my favourites" for
books the household does not own. Every candidate service was checked:

- **Audnexus** — the only genuinely free, key-less, audiobook-native option.
  Its closest thing to similarity is a per-author `similar` array (other
  authors Audible associates with this one). It is **author-level, not
  book-level**.
- **Google Books / Open Library** — no similarity endpoint at all. Open Library
  exposes work-level and author-level links, nothing item-to-item.
- **TMDB / JustWatch** — a real recommendation engine, but it is film and TV.
  Wrong domain, and it needs an API key.
- **Hardcover.app** — GraphQL, has book-level recommendations, but requires an
  account and API key, is reading-tracker data rather than audiobook data, and
  is rate limited.

So there is no free, key-less service that returns "audiobooks similar to
audiobook X".

## Decision
Build the recommendation engine from what the providers *do* expose, and be
explicit that it is tag-similarity rather than a learned recommender.

```
seed (a book, or the union of a profile's favourites)
  → extract seeds: genres, authors, narrators, series, custom tags
  → query the provider chain with those seeds
  → rank locally by weighted tag overlap
  → hard-dedupe against books already in the library
  → surface only what is NOT owned, into the profile's wishlist
```

Weights are declared constants in a pure module and unit-tested. The
interface is `RecommendationProvider`, so a real engine (TMDB, Hardcover, or
LM Studio embeddings) can slot in later without touching the caller.

## Alternatives considered
- **Adopt a key'd service (Hardcover/TMDB)** — genuinely better output, but
  adds an account, a key, a vendor, and a quota, and TMDB is the wrong domain.
- **LM Studio embeddings on descriptions** — offline and private, but requires
  the model to be loaded for a result nobody is waiting on, and the spec 12
  rule is that AI never gates a feature.
- **Recommend owned books only** — simpler, but the brief asks for books the
  household does not have.
- **Ship nothing and let users search providers manually** — rejected; the
  user explicitly asked for a recommendations surface.

## Consequences
- Output quality is bounded by how well genres/authors are populated. On a
  freshly-enriched library it is good; on a library with no enrichment it is
  weak. Recommendations must therefore degrade to a clear "not enough metadata
  yet" state rather than returning noise.
- Nothing is recommended offline. Discover shows an explicit offline state.
- The ranking maths lives in a pure, tested module per the spec 02 rules.