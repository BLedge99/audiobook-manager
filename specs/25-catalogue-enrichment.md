# Spec 25 — Catalogue enrichment that actually populates

## Purpose
Enrichment was leaving most of a book empty. Measured on the 12-book mixed
fixture library (6 LibriVox + 6 commercial) at the start of this spec:

| field | populated |
|---|---|
| genres | 2/12 |
| series | 0/12 |
| publisher | 2/12 |
| published year | 0/12 |
| description | 2/12 |

The user's requirement was explicit: *genre and all the other fields getting
populated*. Every number above is a defect, not a provider limitation.

## Root causes (all diagnosed against the live APIs, not assumed)

1. **Open Library was asked for its default 21 fields and 6 were read.**
   `series_name`, `series_position` and `first_publish_year` come back *by
   default*. For Harry Potter it returned `series ["Harry Potter"]` with
   position `4`, unread. This is why series was 0/12.
2. **`subject`, `publisher` and `isbn` came back ABSENT**, because the search
   never passed `fields=`. Neither book catalogue could ever supply genres.
3. **Google Books returns `{"error"}`** with no API key, so half the chain did
   nothing.
4. **The author was concatenated into the search query**, which degraded
   results: `"Harry Potter and the Goblet of Fire J.K. Rowling"` returned only
   study guides, while the title alone returned the real novel.
5. **Open Library indexes AI-generated study-guide spam.** For Deathly Hallows
   the top two hits were *"Summary of Harry Potter and the Deathly Hallows"*
   (Bookhabits) and *"Conversations on..."* (Daily Books); the novel was not in
   the top five. Those score well on title similarity precisely because the book
   title is contained in them.
6. **`storeCandidates` was not idempotent.** Title search returns *editions* of
   a work, so five editions of one book produced five candidates with identical
   normalised keys and violated a unique constraint, failing the item.

## Behaviour

- **Both catalogues now populate** publisher, year, ISBN, language, series and
  genres, from fields that were already present or simply unrequested.
- **Genres: precision first, then fuzzy.** Seeded mappings match exactly; the
  pre-existing longest-contained-match is the fuzzy fallback. The mapping is
  seeded from headings actually observed on this library.
- **Junk is filtered before mapping**: machine tags (`nyt:...`,
  `series:Harry_Potter`), award and bestseller headings, and non-genre noise.
  Open Library merges every edition's headings, so one Harry Potter volume
  returned ~60 strings across English, Spanish, German and Hungarian.
- **Non-book titles are refused**: `summary of X`, `study guide`, `analysis of
  X`, `conversations on X`.
- **Series is gated**: a provider's series wins; Open Library is consulted only
  when no provider supplied one, and only when it has both a name and a usable
  position.
- **Descriptions are fetched lazily**, only when neither the candidate nor the
  book already has one.
- **Auto-apply is banded, not merely lowered.** Floor 0.7, strong bar 0.9. In
  the band, the author must agree — unless the title matches exactly, which
  matters because LibriVox records "Various" where the file tags a narrator.
  `scoreMatch` is ~85% title-weighted, so a bare floor drop would auto-apply
  books by the wrong author.

## Acceptance criteria

- [x] Open Library returns genres, publisher, ISBN, language, series, year.
- [x] Google Books categories/publisher/date/ISBN/language are mapped.
- [x] Study-guide spam is never chosen as the match.
- [x] The search query is the title alone.
- [x] Junk subject strings are filtered before taxonomy mapping.
- [x] Every genre mapping target is a real taxonomy slug (asserted in a test).
- [x] Open Library series is used only when no provider supplied one, and only
      with a usable position.
- [x] A description is fetched only when one is missing.
- [x] Duplicated candidates are de-duplicated, keeping the best match.
- [x] An exact title match auto-applies regardless of author.
- [x] An explicitly requested threshold is still honoured literally.

## Result (live, 12-book library)

| field | before | after |
|---|---|---|
| genres | 2/12 | **11/12** |
| description | 2/12 | **11/12** |
| publisher | 2/12 | **11/12** |
| cover (served) | 9/12 | **11/12** |
| published year | 0/12 | **8/12** |
| series | 0/12 | **6/12** |
| narrator | 6/12 | **8/12** |
| failures | 0 | **0** |

### Enrichment is not deterministic — read this before trusting a number

Two consecutive forced runs gave **applied 10 / review 1** and then **applied 8
/ review 4**, on identical media. The difference is entirely in the LibriVox
and Open Library books, and it tracks which providers answered during that
particular run. Nothing is cached between runs.

So treat the table above as a range, not a fixed state, and expect the review
queue to move by a couple of books per run until Google Books is available.

Two books are *consistently* in review, and both are correct:
- **Creepy Tales** — best match is *"Twelve Creepy Tales"*, a different book,
  at 0.8 confidence with a disagreeing author.
- **Short Ghost and Horror Collection 034/052** — exact LibriVox title matches
  that intermittently lose the provider race to Open Library.

## Not in this spec

- **Google Books enrichment**, which needs `GOOGLE_BOOKS_API_KEY`. The mapping
  is written and tested; only the key is missing.
- **Audnexus book metadata**, blocked on ASIN discovery with no free route.
- **Series for books no source records.** 6/12 reflects that most of these
  commercial sets have no series data in Open Library at all.