# Spec 38 — Kids accounts: age-appropriate visibility

> **Status: planned, then implemented phase by phase (TDD).** See ADR 033.
> Household-only: the production demo is untouched by this feature.

## Purpose

Adults and children share one server and, until this spec, every account saw
every book on every list, shelf and URL. A per-profile shelf (spec 27) is a
*curation* tool; this spec adds the *permission* system behind it: a child
account sees only what is age-appropriate for it, every book title hidden
means hidden from every list, route and media URL, on every client.

## The decision (ADR 033 — read it first)

1. `role = "child"` on `Profile`, alongside `admin`/`member`.
2. `Profile.ageBand`: `under-6` → maxAge 5, `6-9` → 9, `10-13` → 13,
   `14-17` → 17. No date of birth is stored.
3. `MediaItem.minimumAge Int?` — 0/4/7/9/12/16; `null` = unrated = **visible**.
4. `BlocklistGenre` — admin-managed genre blocklist; blocklisted genres hide
   the book from **every** child band, whatever its rating.
5. Child visibility = `shelf ∩ not-blocked ∩ (minimumAge IS NULL OR minimumAge ≤ band.maxAge)`.
   The gate never widens the shelf.
6. Provider-derived ratings are **suggestions** (`suggestedMinimumAge`),
   never auto-applied. Admin confirm (set `minimumAge`) or dismiss. Admin
   override always wins.
7. Enforcement is server-side everywhere, fail-closed, with hidden books
   answering **404** to children.
8. Kids accounts are created and managed **in the admin panel only**.

## Data model (additive migrations in both Prisma histories)

```prisma
model Profile {
  // ... existing fields ...
  ageBand String? // under-6 | 6-9 | 10-13 | 14-17 — only for role = "child"
}

model MediaItem {
  // ... existing fields ...
  minimumAge              Int?    // confirmed, admin-set; null = unrated
  suggestedMinimumAge     Int?    // provider-derived; never gates
  suggestedMinimumAgeSource String? // "googlebooks" | "openlibrary"
}

model BlocklistGenre {
  id        Int      @id @default(autoincrement())
  genreId   Int      @unique
  createdAt DateTime @default(now())
  genre     Genre    @relation(fields: [genreId], references: [id], onDelete: Cascade)
}
```

`role` stays `String @default("member")`; `"child"` is a new value of the
existing column, not a new table. The schema-guard test extends automatically
(new `BlocklistGenre` carries no `profileId`, so it is not personal data and
needs no personal-data-list entry).

## Behaviour

### Child accounts (admin panel only)

- Admin panel (`ADMIN_PANEL_PASSWORD`, spec 31) gains a **Kids accounts**
  page: list (name, band, disabled, last login), create, rename, re-band,
  disable/enable, reset password, delete, and one **"Add all
age-appropriate books"** button per child.
- Creation: name (unique, case-insensitive-as-today), age band, password
  (8–128 chars, the existing `validatePassword` policy; admin sets it).
  `followsServerLibrary` is **false** (a child shelf never inherits the
  server library automatically) — the fill-shelf action is the explicit,
  one-time exception.
- **Fill shelf** adds every currently age-appropriate book
  (`shelf ∩ visibility` for that child) — one `ProfileLibraryEntry` per
  book, idempotent, returns the count added. It is an explicit admin action,
  never automatic. Re-running it after books are re-rated or new books are
  scanned adds what is now suitable; it never removes anything.
- Deleting a child account behaves exactly like deleting any profile (spec
  28): explicit action, cascades history/favourites/wishlist/membership/
  sessions/credentials; never automatic.
- Family client: children sign in like everyone else (account picker shows
  the Kids account, same public `GET /api/auth/accounts` payload). The menu
  shows a **Kids account** label. There is no child-specific settings screen:
  password change, export and erase work as for every member.

### The visibility rule (single predicate, `server/src/age/`)

```
canProfileSeeBook({ role, ageBand }, { minimumAge, genreIds }, blockedGenreIds):
  if role !== "child"        → true
  if any genreIds ∈ blocked  → false   (blocklist beats everything, every band)
  band = maxAgeForBand(ageBand)  // invalid/missing band ⇒ 5 (fail closed)
  if minimumAge == null      → true    (visible until rated)
  return minimumAge <= band
```

One pure module; every enforcement point calls it. Prisma-facing users get a
`visibilityWhere(...)` builder returning `{ AND: [...] }` composed with the
caller's other `where` clauses; raw call sites use the predicate.

### Enforcement points (all must use the predicate)

| Surface / route | Rule |
|---|---|
| `GET /api/audiobooks` (library list) | age predicate **ands** `libraryEntriesFor(profileId)` |
| `GET /api/server-library` | child: age-filtered; `inLibrary` computed against the same set |
| `GET /api/audiobooks/:id` and progress/tags/candidates single-book routes | child: **404** when not visible |
| `POST /api/audiobooks/:id/library` (add to shelf) | age-checked ⇒ 403 `age_restricted`; **removal is never age-gated** |
| `GET /api/audiobooks/:id/cover`, `GET /api/audiobooks/:id/stream`, `GET /api/tracks/:id/stream`, `POST /api/auth/media-token`, `canReadMediaItem` | child: 404 when not visible (unchanged for everyone else) |
| `GET /api/enrichment/review-queue` | child: **403 forbidden** (was unscoped; fix included) |
| `GET /api/genres`, `GET /api/tags` | `_count` computed over the visible set for children (no catalogue-size leak) |
| `GET /api/favourites(/ids)` | child: visible books only |
| `GET /api/history` | child: entries for visible books only |
| `GET /api/discover/similar/:id` | child: **404** when the seed book is not visible |
| `GET /api/discover/for-me` | child: favourites are already visibility-filtered; suggestions are additionally filtered (below) |
| `GET /api/me/export` | unchanged — it is the child's own data |
| Admin listener (`/api/admin/*`) | unchanged — operator credential, unscoped by design |

### Discover for children

- `for-me` suggestions are generated from the child's **visible** favourites.
- Every candidate suggestion is classified at request time with
  `inferMinimumAgeFromSubjects(candidate.genres)` (Open Library) or
  `minimumAgeFromGoogleBooksMaturity(maturityRating)` (Google Books):
  - classification known and ≤ band max ⇒ shown;
  - classification known and above band ⇒ excluded;
  - **unknown ⇒ excluded** (fail closed).
- The classification ladder is the same 0/4/7/9/12/16 values; no new UI.
- Resulting empty set renders the existing insufficient/no-results Discover
  states; no new client surface. The admin rates books and uses the
  blocklist to fill the gap — ratings live in the shared catalogue.
- Nothing about Discover is persisted for classification; it is a pure
  request-time decision. (No new personal-data category in external calls:
  suggestions flow from data already sent to the providers.)

### Age-rating suggestions (never auto-applied)

During enrichment apply (spec 16 pipeline), if the applied candidate carries
a Google Books `maturityRating` or Open Library subjects that map onto the
ladder **and the book has no confirmed `minimumAge`**, write
`suggestedMinimumAge` + `suggestedMinimumAgeSource`. Suggestions may be
refreshed by re-enrichment, always only while no confirmed rating exists;
they are discarded once the admin confirms or dismisses. Confirmed ratings
are untouched by rescans and re-enrichments — they are part of the shared
catalogue, like any other confirmed metadata.

Admin panel gains an **Age ratings** page:
- list books with a pending suggestion (title, author, source, suggested
  value);
- per book: **Confirm** (sets `minimumAge` to the suggested value, clears
  the suggestion), **Set custom rating** (0/4/7/9/12/16 or clear), or
  **Dismiss** (clears suggestion, leaves `minimumAge` unchanged);
- plus the **Genre blocklist** manager: list genres (with book counts),
  add/remove from the blocklist.

Google Books mapping: `MATURE` ⇒ 16; `NOT_MATURE`/`UNKNOWN`/absent ⇒ no
suggestion. Open Library mapping (subject strings, first match wins):
`picture books`/`children's picture books` ⇒ 6 · `juvenile fiction`/`juvenile
literature`/`middle grade fiction` ⇒ 12 · `young adult fiction`/`teen
literature` ⇒ 13 · `children's literature` ⇒ 9. Admin confirmation is always
required.

### Offline / Android

Replica rows carry `minimumAge` (the payload gains the field server-side).
The offline library path (`local/replica.ts` → `local/librarySource.ts`)
filters with a mirror of the same ladder in `client/src/local/ageFilter.ts`
(pure module, unit-tested). Online filtering remains authoritative; offline
filtering is the same rule applied to the cache. A download made **before**
a book was re-rated persists on device until the next refresh re-evaluates
it, and removal of the download is always available. Documented in
`LIMITATIONS.md`.

### ETag / caching

The ETag hashes the serialised payload, so adding/removing an age field busts
`/api/audiobooks` tags automatically. `/api/server-library` is not
conditional. No cache header changes; `Vary` already carries the session
dimensions used for profile scoping.

## GDPR (Art. 8; household exemption + demo-ready)

**Lawful basis.** Household deployment: Art. 2(2)(c) — purely personal and
household activity, outside the Regulation's scope; documented as such.
Demo-ready documentation (written anyway): the processing is governed by
the household/parental-authority model — the admin (parent/guardian) creates
the account and chooses the band; the child is a data subject; there is no
Art. 8 consent capture in the household model because consent is not the
basis; if this ever ships to the production demo, an Art. 8 analysis and a
Children's Code (AADC) review become mandatory and are tracked as such.
Lawful basis for the process documented in `docs/roa.md` (new activity row)
and `docs/gdpr-governance.md` §2.

**Data minimisation.** The system stores a band (`under-6`…`14-17`), never a
DOB, never the child's real identity beyond the existing profile name.

**Retention.** `Profile.ageBand`, `MediaItem.minimumAge`/suggestion fields
and `BlocklistGenre` rows are added to `docs/retention.md`: age band —
deleted with the profile (erase, or 24-month inactivity purge); book fields —
library catalogue, deleted with the book; blocklist — household
configuration, deleted when the admin removes it. No new TTL machinery.

**Data-subject rights.** Export gains `ageBand` (own data). Erasure needs no
new steps for existing tables; the child's own `/api/me/export`,
`/api/me` (erase) and `PATCH /api/me` work unchanged. Entry added to
`GDPR-data-subject-rights.md` scope note.

**Records to update in the same change.** `docs/roa.md` (new activity +
"Children's data" section; note the household exemption and the P1-5
production condition), `docs/retention.md` (rows), `docs/gdpr-governance.md`
(§2 register + LI balancing refresh), `docs/dpia.md` (children section:
Art. 35(4) criteria, AADC themes — best interests, high privacy by default,
no profiling, data minimisation — and the household-exemption residual
analysis; §7 sign-off note), `docs/GDPR-REMEDIATION-PLAN.md` (dated
Implementation Note: lawful basis / retention / rights impact, referencing
spec 38 and ADR 033), `GDPR-AUDIT.md` (P1-5 cross-reference → spec 38),
`docs/breach-procedure.md` (children as higher-risk data subjects),
`docs/processors.md` (no new processors; suggestion inference uses existing
flows), privacy-notice copy (existing `copy.privacy` gains a children
sentence only if the strings change). `LIMITATIONS.md` gains the offline
caveat.

## Security rules

- Client sends IDs, never paths; server resolves — unchanged.
- Every new input validated by Fastify schema; malformed input is 400.
- `x-profile-id` is never trusted; role and band come from the session.
- Children bypass nothing: `isAdminRoute` unchanged; member-eligible
  metadata routes (ADR 032) remain member-eligible — children may apply
  enrichment candidates exactly as members (that machinery gates on book
  state, not age); admin-only routes refuse children with 403 as for
  members.
- Hidden books answer 404 (existence not leaked), consistent with spec 37
  §7.6 demo-policy behaviour.
- Media tokens are 5-minute, profile- and resource-scoped as today; the age
  check is inside the issuance gate and the read gate.
- The blocklist manager requires the admin-panel credential; no family-client
  path can edit it.

## Acceptance criteria & test mapping

| # | Criterion | Test |
|---|---|---|
| 1 | Non-child roles see everything, unchanged (regression) | existing suite green; `routes/__demo_regression__`-style assertions in Phase 3 step 3.2 |
| 2 | Child sees `shelf ∩ visibility` only; hidden books 404 on detail/stream/cover/media-token | integration tests, `server/src/**/*.age.test.ts` + `inject` |
| 3 | Unrated books visible until rated; blocklist hides regardless of rating; blocklist beats confirm | unit tests `server/src/age/policy.test.ts` |
| 4 | Invalid/missing band ⇒ strictest (5) | unit test |
| 5 | List, server-library, favourites, history, taxonomy counts, review queue all scoped identically | integration tests per route |
| 6 | Media-token & cover/stream refused for hidden books | integration test |
| 7 | Library add 403 `age_restricted`; removal unrestricted | integration test |
| 8 | Discover: unknown/above-band suggestions excluded; seed 404; for-me seeds only visible favourites | unit + integration tests |
| 9 | Suggestions never overwrite confirmed `minimumAge`; confirm/dismiss semantics | integration tests |
| 10 | Fill-shelf adds exactly the age-appropriate books, idempotent | integration test |
| 11 | Child CRUD/reset/disable/delete in admin panel; audit of who/when | integration tests (admin listener) |
| 12 | Erasure of a child profile removes everything (reuse spec GDPR-DSR machinery); export includes ageBand | integration test |
| 13 | Offline replica filters with the same ladder | client unit tests |
| 14 | No new processors; GDPR docs updated in the same change; `personal-data.ts` covers `ageBand`; schema-guard test green | docs review + `gdpr/personal-data.test.ts` |
| 15 | `make test`, `make check-copy`, typecheck (both packages) green; Playwright spec q.v. | CI/local |
| 16 | Production demo behaviour unchanged | existing demo-mode suite untouched & green |
| 17 | E2E: admin creates child → fills shelf → rates one book above band → child signs in → grid hides it, direct stream URL 404s | `e2e/child-accounts.spec.ts` |

## Test infrastructure

Server: Vitest + `inject` against temp SQLite (existing pattern). Pure
modules (`age/bands`, `age/policy`, `age/visibility`, `age/suggestion`,
`local/ageFilter` on the client) are unit-tested without a DB. Admin-panel
routes use the existing admin test helper pattern (`auth.integration.test.ts`).
One Playwright spec covers the end-to-end household flow.

## Out of scope (recorded)

- **Production demo** children's deployment (Art. 8 consent capture, AADC
  sign-off) — household-only; tracked against P1-5 / spec 33.
- **Per-book per-child overrides** (allow this specific borderline book for
  this specific child) — intersection only, for now.
- **Restriction (Art. 18)** for children — deferred as in the member DSR spec.
- **Time-based access** (bedtime windows), content-type rules beyond age —
  not requested.
- **Passwordless child unlock** — children sign in with their own password.
- **Automatic shelf sync** on re-scan: new scans do not silently add books to
  a child's shelf; the admin re-runs fill-shelf (new books are visible in the
  "All books" tab for adults to add). Documented deliberately.

## Test coverage map (to keep in sync while implementing)

- `server/src/age/bands.test.ts` · `policy.test.ts` · `visibility.test.ts` · `suggestion.test.ts`
- `server/src/request-context.test.ts` (extension)
- `server/src/routes/library.test.ts` (extension) · `media.test.ts` (extension) · `enrichment.test.ts` (extension) · `taxonomy.test.ts` (extension) · `discover.test.ts` (extension) · `progress.test.ts` / `profiles.test.ts` (extension)
- `server/src/admin/child-accounts.ts` + `.test.ts` · `age-ratings.ts` + `.test.ts`
- `server/src/gdpr/personal-data.test.ts` (extension)
- `client/src/local/ageFilter.test.ts`
- `e2e/child-accounts.spec.ts`
