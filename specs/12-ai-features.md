# Spec 12 — AI Features (LM Studio, Optional)

## Purpose

AI via LM Studio's OpenAI-compatible API is an optional enhancement — matching
help and summaries — behind an adapter so the provider can change later.

## Behaviour

- `LLMAdapter` interface (`chat`, `embeddings`) with an `LMStudioAdapter`
  (default base URL `http://host.docker.internal:1234/v1`).
- Feature 1 (ship first): **metadata match assistant** — given embedded info +
  folder names, propose the best candidate match and explain why. User still
  confirms (ties into spec 07).
- Feature 2: **description summary** — condense long descriptions to a short
  blurb, cached in DB, regeneratable.
- Every AI feature degrades to "unavailable" with a clean message when LM
  Studio is offline. No feature is blocked on it.
- Config: base URL + model via env; timeout and max retries capped.

## Acceptance criteria

- [ ] App is fully usable with LM Studio off.
- [ ] Match assistant returns a ranked suggestion + rationale for a sample book.
- [ ] Summary cached; offline shows cached or embedded summary.
- [ ] Tests mock the adapter; no test requires a live LM Studio.

## Not in this spec

- Embeddings-based recommendations, Audnexus, voice features.
