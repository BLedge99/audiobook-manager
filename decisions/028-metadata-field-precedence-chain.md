# ADR 028 — Metadata field precedence chain (supersedes the unimplemented parts of ADR 009)

- **Status:** Accepted
- **Date:** 2026-11-11
- **Supersedes:** the *enforcement* described in ADR 009 (the precedence model and the per-field override table remain the intent; this ADR records what the chain means now and resolves the open questions that blocked implementation)
- **Related:** [ADR 009 — Field-level metadata precedence](009-field-level-metadata-precedence.md), [spec 37 — Architecture deepening](../specs/37-architecture-deepening.md) (Phase 5), [spec 17 — Metadata enrichment](../specs/17-metadata-enrichment.md)

## Context

ADR 009 defined the intended precedence chain as:

```
user override  >  enriched  >  embedded tag  >  filename/folder derived
```

and required the scanner and the enrichment applier to become field-aware. In practice that chain was never enforced: `server/src/metadata/precedence.ts` exists and is tested, but nothing in production imports it. The rule is re-derived at three call sites (`scanner.ts`, `metadata/apply.ts`, `metadata/run.ts`) and re-implemented twice in `app.ts`, and the effective behaviour is **last writer wins**:

- the scanner writes embedded values, guarded only by the user-override set;
- the enrichment applier writes enriched values, guarded only by the user-override set;
- whichever writer ran last wins for a field that is not user-overridden.

A rescan can therefore overwrite an *enriched* title with the *embedded* title, and only a user override survives a later conflicting write. There is no `derived` (filename/folder) layer in the data model or the write paths today. `metadataSource === "user"` is still read as a legacy freeze signal in `scanner.ts`, but nothing writes it any more, so the freeze it once guarded is unrecoverable.

Spec 37 step 5.1 requires the meaning of the chain to be decided and recorded before the code is changed.

## Decision

### 1. The precedence chain

The canonical per-field precedence is:

```
user override  >  enriched  >  embedded tag  >  derived (filename/folder)
```

This matches ADR 009. The **`derived` layer is not yet implemented** in ingestion or storage; it is reserved in the resolver so the chain is complete and can gain a writer later without changing the rule. Until a derived writer exists, the effective active chain is `user override > enriched > embedded`.

**Rationale (architecture / industry practice):** metadata systems that merge multiple sources (media servers and library managers such as Emby, Jellyfin, Plex and Audiobookshelf, and tag-management tools generally) resolve conflicts with an explicit priority order and treat manual/user-locked edits as the highest-priority source so they survive rescans and re-fetches. Provider/fetched (enriched) metadata is typically preferred over raw embedded tags because it is curated for the work/edition, while embedded tags remain the on-disk fallback and filename/folder guesses are the lowest-confidence source. Audiobookshelf exposes a configurable “metadata order of precedence” per library; the common default family is provider > embedded with manual locks always winning. A last-writer-wins rule is simpler to implement but is not a stable precedence policy: it discards curated enrichment on rescan and makes outcomes depend on execution order.

### 2. Which source wins when enriched and embedded disagree

**Enriched wins over embedded.** When a field has an enriched value and the scanner produces an embedded value, the enriched value is kept for any field that is not user-overridden. A rescan must not replace an enriched value with an embedded one. Concretely, the scanner may write a field's embedded value only when the field is not user-overridden and no higher-precedence non-empty value (enriched) is present for that field.

Enrichment is the higher-confidence, curated source relative to raw file tags; preserving it across rescans is the reason the chain exists.

### 3. User overrides

**A user override wins for that field, and enrichment may change or clear non-overridden fields.** Overrides are per-field (as in ADR 009): only the specific fields a human has set are protected. The scanner and the enrichment applier must not modify an overridden field. Enrichment may set, replace, or clear any field that has no user override, including fields it previously enriched, according to the result of the enrichment run.

This keeps manual corrections durable while allowing re-enrichment to improve or retract metadata the user has not claimed.

### 4. The legacy `metadataSource === "user"` sentinel

`metadataSource === "user"` is **retired as an override/freeze mechanism**. It is not a reliable guard (nothing writes it), so it must not be used to protect fields. Per-field protection is expressed only through `FieldOverride` rows (and the precedence resolver). `metadataSource` remains, where still useful, as a **provenance** label for where a value came from (e.g. embedded, a provider id, manual), not as a lock. Code that currently reads the legacy sentinel must stop treating it as authoritative for write protection; migration/cleanup of any stale `user` provenance values is handled in the implementation steps that follow this ADR.

## Consequences

- **One enforced rule.** A single resolver/module becomes the authority for “may this writer change this field?”; the scanner, the enrichment applier/run, and the routes stop re-deriving precedence. (Implemented in spec 37 step 5.2.)
- **Rescans become safe for enriched data.** Re-scanning the library no longer discards enrichment for non-overridden fields.
- **Deterministic outcomes.** Given the same stored layers and overrides, the resolved value for a field is independent of which writer ran last.
- **Derived layer deferred, not forgotten.** The chain reserves `derived`; adding a filename/folder writer later means populating that layer, not redefining precedence.
- **Behaviour change.** Some flows that previously “worked” only because the last writer happened to win will now follow the chain; tests and callers that assumed last-writer-wins must be updated to the declared precedence.

## Alternatives considered

- **Keep last-writer-wins (current behaviour).** Simplest in the short term and requires no semantic change, but it contradicts ADR 009, loses enriched metadata on rescan, and makes results depend on run order. Rejected as the steady-state rule (it may be documented as the pre-5.2 reality, not preserved as the design).
- **Enforce `user override > embedded > enriched`.** Would make rescans authoritative over enrichment. Rejected because enriched/provider data is the curated source and the user explicitly chose enricher-over-scanner; it would also make re-enrichment unable to improve over tags.
- **Drop the `derived` layer from the model.** Would match today’s lack of implementation but would force a chain redesign when filename/folder derivation is added. Rejected in favour of reserving it in the resolver.
- **Keep `metadataSource === "user"` as a coarse lock alongside overrides.** Redundant with per-field overrides, already unwritten/unrecoverable, and reintroduces all-or-nothing freezing. Rejected; provenance and protection are separate concerns.
