# Spec 12 — AI Features (LM Studio, Optional)

> **Status note (2026-11-17):** Implemented as scoped, with corrections to the
> Behaviour list below: the `LLMAdapter` exposes `chat` + `available()` only
> (no `embeddings`), and the timeout is a hardcoded 15 s with no retries. The
> AI path never gates core behaviour; tests mock the adapter. Criterion 1 and
> 4 are verified against the code; criterion 2 shipped only as stored-candidate
> selection (no ranking, no rationale, not wired into the UI); criterion 3
> (cached summary) was never built and remains unbuilt.

## Purpose

AI via LM Studio's OpenAI-compatible API is an optional enhancement — matching
help and summaries — behind an adapter so the provider can change later.

## Behaviour

- `LLMAdapter` interface (implemented as `chat` + `available()`; embeddings
  were considered and dropped) with an `LMStudioAdapter`
  (default base URL `http://host.docker.internal:1234/v1`).
- Feature 1 (ship first): **metadata match assistant** — given embedded info +
  folder names, propose the best candidate match and explain why. User still
  confirms (ties into spec 07).
- Feature 2: **description summary** — condense long descriptions to a short
  blurb, cached in DB, regeneratable.
- Every AI feature degrades to "unavailable" with a clean message when LM
  Studio is offline. No feature is blocked on it.
- Config: base URL + model via env; timeout fixed at 15 s (no retries).

## Acceptance criteria

- [x] App is fully usable with LM Studio off.
- [ ] Match assistant returns a ranked suggestion + rationale for a sample book.
      As shipped, `POST /api/audiobooks/:id/ai-suggest` picks one stored
      candidate (the prompt asks for "just the number"); there is no ranking,
      no rationale text, and it is not wired into the client UI.
- [ ] Summary cached; offline shows cached or embedded summary.
      **Not implemented** — no summary route, cached column or AI blurb exists.
- [x] Tests mock the adapter; no test requires a live LM Studio.

## Not in this spec

- Embeddings-based recommendations, Audnexus, voice features.
