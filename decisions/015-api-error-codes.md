# ADR 015 — The API sends error codes; the client owns the words

## Status

Accepted. Implements decision 1 of `specs/15b-post-testing-polish.md` §7b.

## Context

Interface copy has one source of truth: `client/src/copy.ts`, checked by
`scripts/check-copy.mjs` and `copy.test.ts`. That rule had a hole large enough
to drive a second catalog through.

Failed API calls answered `{ message: "..." }`, and the client rendered it:

- `client/src/lib/api.ts`, `useLibrary.ts`, `useBrowse.ts`,
  `ReviewQueue.tsx` and `TagManager.tsx` each parsed `body.message` and threw
  it, so a hook's error state could show it;
- `App.tsx` alerted `requestError.message` when adding a folder or starting a
  scan;
- the global handler in `server/src/app.ts` echoed Fastify's `error.message`
  on any 4xx.

Two problems followed.

**The copy rules could not see the sentences.** Banned vocabulary, the
glossary, punctuation and the duplicate check all read `copy.ts`. A sentence
written in `app.ts` was invisible to every one of them, so it could drift from
the voice with nothing to catch it.

**The 4xx echo leaked internals.** `error.message` from Fastify validation is
`body/name must be string`; from a thrown route error it can carry a filesystem
path or Prisma wording. `specs/11-security-hardening.md` already required error
hygiene, and this path did not meet it.

The messages were also duplicated by construction: `"Incorrect password"` on
the server and `copy.login.wrongPassword` in the client; the same for the
duplicate-profile sentence. The client already ignored the server's version in
both places, which is a good sign the server was the wrong owner.

## Decision

**A failed request answers with a stable code and values, never a sentence.**

The envelope is top-level, matching the `{ message }` it replaces:

```json
{ "code": "tag_name_rejected", "params": { "reason": "reserved" } }
```

- `server/src/http-errors.ts` defines `ApiErrorCode`, `ApiErrorParams`, and one
  `fail(reply, status, code, params?)` helper. Every route uses it, so the shape
  is defined once.
- `server/src/app.ts`'s global handler answers `internal_error` for a 5xx and
  `request_invalid` for a 4xx, and logs `error.message` server-side. The client
  never sees it.
- `client/src/lib/apiError.ts` is the only reader of the shape. It maps the
  code into `copy.apiErrors`; the snake_case code becomes the camelCase key.
- An unknown, missing or non-JSON code renders
  `copy.errors.requestFailed(status)` — a sentence that names the failure and
  the next step. A newer server adding a code degrades an older client to that
  sentence instead of `undefined` or raw prose.
- Two codes already had a reviewed sentence: `incorrect_password` resolves to
  `copy.login.wrongPassword`, and `profile_name_taken` to
  `copy.profile.duplicate`. The resolver aliases them rather than duplicating
  the text.

**This pass is plumbing.** The sentences in `copy.apiErrors` are the server's
old sentences, kept verbatim — two glossary warnings in the checker are the
visible cost. The wording pass (the next step in §7b) rewrites them, and most
should collapse into `copy.errors.requestFailed`.

The one deliberate visible change is `request_invalid`: a framework validation
failure used to show its internal wording and now shows the generic sentence.
That is the leak the contract closes, not an accident.

## Alternatives rejected

**Keep `message` as a fallback during a transition.** The client is the only
consumer, and it ships from the same repository, so there is no compatibility
window to protect. Keeping both would leave the second catalog alive and make
"which one is rendered?" a permanent question.

**A nested `{ error: { code, params } }` envelope.** Conventional, and it leaves
room for `traceId` or field errors. Rejected because `{ message }` was
top-level, and the smaller diff is easier to review; the envelope is now
defined in one helper, so adopting nesting later is a one-file change plus a
resolver change.

**Put the code-to-sentence map in the server's response as a `message`.** That
is the current design with a lookup step: the client would still render prose
the copy rules cannot reach.

**Show the code itself when it is unknown** (e.g. `unexpected_error`). Useful to
a developer, meaningless to a listener, and it breaks the rule that a status
code is never the whole message.

**Translate the server's `reason` values on the server.** `reason` is the tag
validator's short code (`reserved`, `too-long`), not prose. Sending it as a
parameter lets the client phrase it and keeps the validator's vocabulary out of
the interface.

## Consequences

- **One catalog.** Every sentence a person can read now lives in `copy.ts`, and
  the checker and `copy.test.ts` can reach all of it.
- **Error bodies carry no paths, no Prisma wording, and no stack detail.** The
  detail stays in `request.log.error`.
- **Adding an error is two-sided and deliberate:** a code on the server, an
  entry in `copy.apiErrors` (or the generic fallback). A forgotten client entry
  is a generic sentence, not a blank.
- **The server no longer needs to know the interface voice**, so a route can be
  tested on status and code rather than on prose. `app.test.ts` now asserts the
  shape for `auth_required`, `incorrect_password`, `profile_required` and a
  parameterised `tag_name_rejected`.
- **Discover is not covered yet.** `Recommendation.reason` and the non-`ok`
  `message` are success-payload prose, not errors. They are on the remaining
  worklist in §7b and move with the wording pass.

## Verification

- `server` typechecks (`npx tsc --noEmit` in the server container).
- `server` suite: 431 passed. One unrelated taxonomy test times out at its 5 s
  default under the container (`genre seeding > is idempotent`); it passes with
  `--testTimeout=20000` and does not touch the error path.
- `client` suite: 367 passed, 27 files.
- `npm run check:copy`: 0 errors, 5 warnings (three pre-existing, two glossary
  warnings on the preserved server sentences).
- `npx tsc -b` (client): clean.
