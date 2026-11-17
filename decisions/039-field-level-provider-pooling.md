# ADR 039 — Field-level provider pooling

## Status
Accepted, superseding ADR 008's early-stop rule for enrichment runs.

## Context
The title/author winner is not necessarily the provider that has every useful
field. LibriVox can identify a public-domain recording and provide its reader
and description, while Open Library or Google Books supplies genres, ISBN, or
publication facts. Applying only the winner drops that complementary data.

## Decision
Search providers sequentially in the resolved order and retain the highest
confidence candidate as the match winner. Continue the chain to collect
complementary candidates. A candidate may fill a field only when its title and
author are compatible with the queried book. Prefer the winner for each field;
otherwise use the highest-confidence compatible candidate that supplies it.

Provider-specific fields such as genres keep the supplying provider identity
for mapping. The overall `metadataSource` and confidence continue to describe
the match winner. User field overrides remain authoritative.

## Consequences
- Enrichment makes more provider requests than an early-stop chain, but
  existing provider failure isolation still applies.
- A strong match can contribute fields without replacing better winner data.
- Provider-specific field mapping remains correct, and a conflicting author
  prevents an alternative candidate from contributing.
