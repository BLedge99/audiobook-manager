# ADR 033 — Kids accounts: a child role, an age ladder, and fail-closed hiding

> Builds on ADR 016 (profiles are accounts), ADR 019 (PostgreSQL production,
> SQLite local), ADR 022 (admin panel is a separate door) and ADR 026 (row-level
> security in production). Extends spec 27 (per-profile library membership) and
> spec 28 (roles); scoped out there, in scope here.

## Context

The household shares one server. Adults and children share it, and until this
ADR every profile — whatever its owner's age — saw every book on every list,
every shelf and every direct URL. Spec 27 made shelves per-profile but empty
by default, which fixed curation, not appropriateness: nothing stopped a
child profile adding, opening or streaming a book far beyond that child's
reading age, and the per-profile shelf is a *curation* tool, not a *permission*
system.

`specs/28-accounts-passkeys-biometrics.md` explicitly listed "parental
controls or per-book age gates" as out of scope. `docs/roa.md` and
`GDPR-AUDIT.md` (P1-5) document the absence of any age-gating as a known gap
for children's personal data under Art. 8 UK/EU GDPR.

Two questions had to be answered before any code could be written:

1. **What marks a child account?** A derived age (DOB stored on the profile)
   processes more personal data than the policy needs and would need its own
   retention and erasure analysis. A second boolean flag (`isChild`) created a
   second axis the whole codebase would have to check in parallel with role.
   The existing role plumbing (`admin` | `member`) already gates routes,
   sessions and the admin panel; it is the cheapest correct seam.
2. **What marks a book as unsuitable?** Providers disagree and most books
   carry nothing. The ladder must be settable by the admin (override always
   wins), default-safe, and survive a re-scan without freezing unrelated
   fields.

## Decision

1. **A child is a role: `role = "child"`** on `Profile`, alongside `admin` and
   `member`. `isAdminRoute()` is untouched — a child is not an admin. On
   screen the role is called **Kids account**; `member` remains
   server-internal and never appears in copy.
2. **The child's age is a band, not a date of birth.** `Profile.ageBand` is one
   of `under-6` (maxAge 5), `6-9` (9), `10-13` (13), `14-17` (17), chosen by
   the admin at account creation. No date of birth is stored; the band is the
   only age data the system holds, and it is personal data under Art. 4(1),
   documented as such.
3. **A book carries `MediaItem.minimumAge Int?`** (0/4/7/9/12/16; `null` =
   unrated). A child may see a book iff `minimumAge IS NULL OR minimumAge <= band.maxAge`,
   **and** none of the book's genre ids is on the household genre blocklist.
   Unrated books are visible — the household starts with an unrated catalogue
   and this must not brick the feature — except when blocklisted by genre.
   The blocklist is an admin-managed table (`BlocklistGenre`), like the tag
   vocabulary, not a hard-coded list.
4. **The gate intersects the shelf; it never widens it** (spec 27 order).
   Child sees: `ProfileLibraryEntry(shelf) ∩ visibility(band)`. Removal from
   shelf is never age-gated; addition is. A new child account therefore sees
   an empty library until the admin uses the one-tap **"Add all
   age-appropriate books"** action on its admin-panel page (or adds books
   individually from the child's "All books" tab, which is itself age-filtered).
5. **Enforcement is server-side, everywhere, fail-closed.** The visibility
   predicate lives in one pure module (`server/src/age/`) consumed by every
   enforcement point: `GET /api/audiobooks`, `GET /api/server-library`, single
   book detail, media/cover/stream routes, media-token issuance,
   `canReadMediaItem`, favourites, history, review queue (children: 403),
   taxonomy/tag counts (computed over the visible set). A hidden book answers
   **404 not_found** — its existence is not revealed, even to a child who
   knows its id. Client-side rendering is cosmetic and the server never
   relies on it.
6. **Provider-derived ratings are suggestions only.** Google Books
   `maturityRating` (`MATURE` ⇒ 16; anything else ⇒ no suggestion) and
   Open Library juvenile/children subject heuristics populate
   `MediaItem.suggestedMinimumAge` + `suggestedMinimumAgeSource`. They never
   overwrite and never gate; the admin confirms (sets `minimumAge`) or
   dismisses, in the admin panel. **Admin override always wins; nothing
   auto-applies.**
7. **Children are full members for their own data.** Export, erasure,
   password change, progress, favourites and wishlist work exactly as for a
   member — rights are a function of session identity, not of age.
8. **Household-only.** The production demo is general-audience and unchanged;
   demo-mode behaviour is asserted unchanged. The GDPR documentation is
   nevertheless written to demo-ready standard (RoPA, retention, governance
   register, DPIA delta, remediation-plan note, audit P1-5 reference, breach
   procedure), so promotion to production later is a documentation review,
   not a build.
9. **Kids accounts are created and managed in the admin panel only**
   (`ADMIN_PANEL_PASSWORD`, spec 31/ADR 022): create (name, band, 8+
   password), re-band, disable/enable, reset password, rename, delete, and
   the fill-shelf bulk action. The family app never creates or toggles a
   child account. Rating a book (set/clear `minimumAge`, suggestion
   confirm/dismiss, blocklist edit) is likewise admin-panel-only.
10. **Losing visibility is silent but reversible.** A book re-rated above a
    child's band disappears from that child's next fetch immediately (ETag
    busts automatically). The empty state says nothing about hidden books.

## Alternatives rejected

1. **Store date of birth; derive "is child" and band from it.** Rejected: GDPR
   data minimisation (Art. 5(1)(c)) — the system needs a ceiling, not a
   birthday — and DOB drags erasure, retention and rectification obligations
   the feature does not need.
2. **Boolean `isChild` flag alongside role.** Rejected: two axes for one
   concept; every gate site would need both, and the admin panel would need a
   migration story for existing rows anyway.
3. **Fail-closed for unrated books.** Rejected: the household catalogue starts
   with zero ratings; a fail-closed default shows children nothing and makes
   the feature feel broken. Genre blocklist covers the clearly-unsuitable
   case; suggestions + admin rating close the rest over time.
4. **Rating books from the family app book page.** Rejected by the household:
   rating is catalogue curation for the shared shelf; it belongs to the
   operator tier (admin panel), like the rest of enrichment.
5. **External Discover ratings via per-request Open Library subject
   inference.** *Kept*, but scoped: subjects map to the same 0/4/7/9/12/16
   ladder; suggestions that cannot be classified are **excluded** for child
   profiles (unknown ⇒ excluded), consistent with the rest of the gate.

## Consequences

- `MediaItem.minimumAge`, `suggestedMinimumAge`, `suggestedMinimumAgeSource`,
  `Profile.ageBand`, `BlocklistGenre` are additive migrations in **both**
  Prisma histories.
- Every book-list route gains the shared `visibilityWhere` predicate; a
  review-queue and taxonomy-counts scoping fix ships with it, closing two
  pre-existing non-scoped reads noted in the spec-38 exploration.
- New personal-data fields are covered by the one personal-data list
  (`personal-data.ts`); the schema-guard test extends automatically.
- Offline/Android: replica rows carry `minimumAge`; the offline path filters
  with the same ladder. A download made before a book was re-rated persists
  until refresh — recorded in `LIMITATIONS.md`.
- No new processors are introduced; suggestion inference runs on data already
  requested in existing enrichment flows.
- `docs/roa.md`, `docs/retention.md`, `docs/gdpr-governance.md`,
  `docs/dpia.md`, `docs/GDPR-REMEDIATION-PLAN.md`, `GDPR-AUDIT.md`,
  `docs/breach-procedure.md` and the privacy-notice copy are updated in the
  same change as the code, per `AGENTS.md`.
