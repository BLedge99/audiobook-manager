# ADR 009 — Field-level metadata precedence

## Status
Accepted

## Context
Spec 07 records a user's confirmation by writing `metadataSource = "user"` onto
`MediaItem`. The scanner reads that one flag and, on rescan, skips writing
**title, author, narrator, releaseDate, genre and coverImagePath** — all six
together.

That is all-or-nothing. A user who fixes only a misspelled narrator name
silently freezes the title too, and it will never pick up a better match no
matter how many scans run. Conversely, there is no way to say "this title is
mine, but let enrichment keep improving the narrator."

There is also no record of *what* was overridden, only *that* something was.

## Decision
Replace the sentinel with an explicit override table and a fixed per-field
precedence chain.

```
user override  >  enriched  >  embedded tag  >  filename/folder derived
```

- New `FieldOverride(mediaItemId, field, value)` rows record exactly which
  fields a human set. Only those fields are protected from the scanner and
  from re-enrichment.
- An explicit **reset** action clears overrides for one book (restoring
  embedded values) or for the whole library, so a bad mass rewrite is
  reversible without dropping the database.
- `metadataSource` is retained, but as a *provenance* label
  (`embedded | librivox | audnexus | googlebooks | openlibrary | manual`)
  rather than an override mechanism.

## Alternatives considered
- **Keep the all-or-nothing sentinel** — predictable, and simpler. Rejected:
  it makes partial corrections impossible, and spec 17 requires per-field
  behaviour anyway (a locked narrator, an unlocked series).
- **A single `overrides` JSON column on `MediaItem`** — one row fewer, and
  avoids a join. Rejected: Prisma does not support `Json` on SQLite, it is not
  queryable ("all books where series is overridden"), and it makes audit and
  reset awkward. A real table also ports to PostgreSQL unchanged.
- **Per-book lock toggle** — coarser than per-field, and still not selective
  about *which* fields.

## Consequences
- Overrides become inspectable and auditable ("what did I actually change?").
- The scanner and the enrichment applier must both become field-aware; this is
  the main cost of the change.
- Mass enrichment can now rewrite everything except the specific fields a
  human has touched, which is what makes running it without a dry run
  defensible.