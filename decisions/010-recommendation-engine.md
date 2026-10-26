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

## Amendment (2026-10-18) — the survey was right, and it was still not enough

The conclusion above held. No free service returns audiobook-to-audiobook
similarity. What went wrong is that this ADR settled the question at *one* level
of abstraction — item-to-item similarity — and the implementation then went and
asked a different question of the same providers: "give me books about horror".

It got nothing, and it is worth recording exactly why, because both failures are
invisible in the code that was written:

- **Audnexus was treated as a search provider.** It is not. `search()` is a
  deliberate no-op that resolves an ASIN you already hold. ADR 010 knew it was
  "author-level, not book-level" and was right — the consequence, that it can
  never seed Discover, was never drawn.
- **LibriVox was treated as a fuzzy title matcher.** It is exact. Its own
  `search()` says so in a comment. Feeding it genre names returned 404 for
  "fiction" and one book for "short stories" — the one literally titled that.

Open Library was dismissed in this ADR for having "no similarity endpoint at
all". True, and beside the point: it was never asked for similarity. It has a
subject search, free and key-less, returning ~35,000 documents for
`subject:horror`. The survey looked for a recommendation service and did not
look for a browsing primitive.

The fix browses by subject and ranks locally, exactly as this ADR's `Decision`
section describes — the pipeline was right. Only the seed-to-provider step was
wrong, and it was wrong in a way that made the feature return nothing, forever,
while looking like it was honestly reporting an empty result.

**What this ADR should have said:** a provider being unsuitable for
*similarity* does not make it unsuitable for *this*, and "no free
recommendation service exists" is a statement about one query shape rather than
about the provider's capabilities.

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