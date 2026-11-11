# ADR 030 — Audnexus leaves the title-driven provider interface

## Status

Accepted 2026-11-11. Completes ADR 008 (Audnexus out of the title-driven
chain) and ADR 011 (Audnexus is an ASIN-keyed chapter lookup). Spec:
[`specs/37-architecture-deepening.md`](../specs/37-architecture-deepening.md),
step 10.3.

## Context

ADR 008 removed Audnexus from the title-driven enrichment chain after the
`/books?title=` endpoint 404'd on every call; ADR 011 then repositioned it as
an ASIN-keyed capability for official chapter titles. But the provider
*interface* still advertised it: `ProviderId` included `"audnexus"`,
`PROVIDER_IDS` listed it, and `createProviders()` constructed it — a
capability the chain will never walk, exposed to every caller of the
interface.

## Decision

Audnexus leaves the title-driven provider interface entirely:

- `ProviderId` is `"librivox" | "googlebooks" | "openlibrary"` and
  `PROVIDER_IDS` matches — the chain's advertised surface is the set it
  actually walks.
- `createProviders()` constructs those three and nothing else.
- The ASIN-keyed capability is a named client, `AudnexusAsin`, with
  `bookByAsin()` and `chaptersByAsin()` (spec 21), plus the pure mapper
  `mapAudnexusBook`. It is not a `MetadataProvider` and has no `search()` —
  there is nothing a title search could ever call.
- The genre-mapping tables key Audnexus rows by the string `"audnexus"`;
  that is a separate concept (the provider of a raw genre string) and is
  unchanged.

## Consequences

- `resolveProviderOrder` never returns `"audnexus"`, and a unit test proves
  it stays that way.
- Spec 21's chapter lookup is unchanged — `run.ts` calls
  `AudnexusAsin.chaptersByAsin`.
- Nothing about production behaviour changes; the interface stops lying.

## Alternatives considered

- **Keep it in the interface with a `notTitleSearchable` flag.** Rejected:
  a flag the walk loop ignores is the same broken advertisement with a
  longer name, and every future caller has to remember to check it.
- **Walk it in the chain anyway.** Rejected: one guaranteed-404 per book,
  which is the exact failure ADR 008 documented.
