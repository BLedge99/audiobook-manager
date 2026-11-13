# Spec 39 — External providers: client-side external books and Discover buy links

## Purpose

Two related surfaces, one research envelope ([`docs/external-providers-research-2026-11.md`](../docs/external-providers-research-2026-11.md); ADR [`decisions/034-external-items-and-check-price-buy-links.md`](../decisions/034-external-items-and-check-price-buy-links.md); build plan [`docs/external-providers-plan.md`](../docs/external-providers-plan.md)):

- **Feature A — External library items.** A book the user owns on Audible,
  Google Play Books, Kobo or Libro.fm can appear in this app's library,
  **client-side only**. It never reaches our server, cannot be played, and
  deep-links into the store app to read.
- **Feature B — Discover buy links.** A Discover result (or book detail) can
  offer "where to get this": a **Free** row when the title exists in LibriVox,
  and **check-price** rows for legitimate vendors. Clicking opens the book's
  page in the store (app when installed, browser otherwise). We never display
  a price we did not fetch live at render time, and in v1 we display none at all.

Non-goals (permanent): playing, streaming, syncing or reading progress from
any store; scraping; price storage; Amazon affiliate in the app.

## Research verdicts this spec encodes

See the research doc for sourcing. Summary:

1. No consumer API exists for store playback, libraries, entitlement or
   position. Audible: nothing public, AAX DRM, ToS + DMCA §1201. Play Books:
   Books API = ebook `saleInfo` only; audiobook ids unattainable; "My Library"
   Classic retires 2026-11-18. Kobo / Libro.fm / Chirp / Storytel / Everand:
   nothing official. Libby: partner-gated only.
2. Prices in-app are legally constrained to "check price" link-out. The web/PWA
   is the only surface where Amazon affiliation could ever live (Approved
   Mobile Application; ≥10 qualifying sales/30d; 1-hour refresh; comparison
   display incl. used price). See ADR 034.
3. Link-outs to public product pages are lawful hyperlinks; deep linking is
   not scraping. LibriVox recordings are CC0/public-domain.

## Feature A — External library items (Android first; the PWA shares the code path but device-local storage means items do not roam)

### Data model (client only)

`ExternalLibraryItem` (Dexie table alongside the read replica):

```
id                // local uuid
store             // 'audible' | 'playbooks' | 'kobo' | 'librofm'
externalId        // ASIN / Play book id / Kobo product id / Libro.fm isbn13
title, author, narrator?, coverUrl?
httpsUrl          // canonical product page used for launch
createdAt
```

- Never synced to `server`, never serialized into any API request, never in
  exports. (Privacy posture: these rows reveal what the user buys — the one
  dataset we do not want centralised.)
- Dedupe: on add, match `store + externalId`; re-adding refreshes metadata,
  keeps `createdAt`.
- The Library grid merges replica books and external items, external cards
  carry the store badge and a distinct detail affordance; filtering treats
  them as a `store` facet (not genres), all-optional.
- Deleting an external item removes the local row only.

### Ingest (v1)

1. **Paste URL.** A paste target on the "Add book" affordance (Library or
   Discover sheet → "I own this elsewhere"). Accepted hosts and id extraction
   are table-driven from the registry:
   - `audible.com/pd/…/<ASIN>` (also `.co.uk` etc., `amzn.to` redirects
     not followed),
   - `play.google.com/store/audiobooks/details?id=<id>` (incl. `books/`
     sibling path),
   - `kobo.com/{region}/{lang}/audiobook/{slug}`,
   - `libro.fm/audiobooks/<isbn13>-…`.
   Unparseable input → validation error, nothing stored. The item is created
   with registry-embedded metadata templates only (title/author are read from
   the URL slug when present, else "Unknown title" + the URL); a provider
   lookup (Open Library / LibriVox by ISBN when present) MAY enrich title,
   author and cover — offline, it does not.
2. **No share-sheet ingest in v1** (designed fast-follow; adds an
   ACTION_SEND `text/plain` filter and EXTRA_TEXT parsing).

### Launch

- Native plugin `ExternalIntent` (see ADR 034 §4): `canResolve(url, package?)`
  / `launchIntent(url, package?, chooserTitle?)`. Fallback chain per
  ADR 034 §4. `<queries>`: the four store packages + one BROWSABLE https
  intent filter. No `QUERY_ALL_PACKAGES`, no notification access.
- If the store is not installed: the primary button becomes
  "Get <store> on Google Play" (Play link works from sideloaded apps) with the
  browser link secondary.
- UI copy is explicit everywhere: "Opens in Audible ↗" — the app never
  implies it plays anything.

### Detail/card affordances (child profiles)

The external card, its detail page and the buy links are **not rendered for
`role = "child"` profiles** (spec 38 gate) — no store badges, no outbound
links, not even read-only rows. External items are a grown-up surface.

### Progress

None in v1 (ADR 034 §2). No position, percent, session note or estimate is
shown or stored for external items. If a compliant signal ever exists, it
arrives as a new ADR against 034 §2.

## Feature B — Discover buy links

### Placement

- Discover card → bottom sheet ("Get this book") containing one row per
  available option (below). Same sheet on the wishlist item detail.
- Rows are shown only for profiles with `role = "adult"` (spec 38 gate;
  admin/member both qualify, child doesn't).
- Every commissionable row carries the inline cue "Ad · we may earn a
  commission" **adjacent to the button** (16 CFR Part 255; ASA/CAP), plus a
  footer disclosure on the sheet: "As an Amazon Associate we earn from
  qualifying purchases" is NOT shown (no Amazon affiliate in-app); the footer
  names whichever networks actually apply from configuration, e.g. "Audiobook
  purchases made through these links may earn us a commission (Libro.fm via
  Awin, Kobo via Rakuten, Bookshop.org, Barnes & Noble via Impact)."
- No prices, no "lowest price" claims, no comparison framing, no strikethrough
  "was" prices, no price alerts. Each row is exactly: vendor name +
  "Check price →" (or LibriVox's "Free →").

### Rows (v1)

| Row | Condition to show | Target |
|---|---|---|
| LibriVox — "Free" | `/api/buy-context` returns a match: normalized title token overlap ≥ 0.85 **and** author last-name agreement (matching `librivox.ts` style); provider `librivox` on the candidate also shows the row without a lookup | `librivox.org/rss/<id>` and/or archive.org `details/<id>`; copy: "Public-domain recording hosted by LibriVox. Source: LibriVox. Legal status of the text varies by country." |
| Libro.fm | Always (universal fallback) | `https://libro.fm/?q=<isbn13 or title author>` (ISBN-keyed product paths are slug-dependent, unbuildable offline) |
| Bookshop.org | Same | `https://bookshop.org/search?keywords=<q>` |
| Barnes & Noble | Same | `https://www.barnesandnoble.com/s/<title author>?ean=<isbn13>` with `ean` when known, else `…/s/<title author>` |
| Kobo | Same | `https://www.kobo.com/<region>/<lang>/search?query=<title author>` (ISBN-keyed path when the match returns an id; registry holds the template) |
| Audible/Amazon | Same | `https://www.audible.com/search?keywords=<title author>` (search URL — per-title ASIN is unattainable via official means; never construct an ASIN-bearing URL heuristically) **untagged** |
| Google Play Books | Same | `https://play.google.com/store/search?q=<title author>&c=books` **untagged** |

- **Affiliate tags**: from build-time config (`AFFILIATE_LIBROFM`,
  `AFFILIATE_BOOKSHOP`, `AFFILIATE_KOBO`, `AFFILIATE_BN`); absent ⇒ untagged
  and identical behaviour. Tokens are **not** committed if the repo is public;
  production demo may supply them. No token is ever sent anywhere except in
  the outbound link itself.
- LibriVox row shown first when available; it is the only "this is actually
  free" truth on the sheet and is visually distinct (no AD cue).
- All rows are composed client-side from a registry module (ISBN-keyed or
  title/author search-URL fallback). The **one server dependency** is
  `GET /api/buy-context?title=&author=` → `{ librivox: { url, title } | null }`,
  because librivox.org sends no CORS header, so the client cannot call it.
  The endpoint does a single cached (5-minute TTL), deadline-bound LibriVox
  lookup (identifiers only — title/author, like the existing enrichment
  providers; see `docs/processors.md`); results are never persisted, no query
  is logged, and the sheet renders fine when it returns null. The ISBN, when
  present, rides on the existing `Recommendation` payload (`isbn` passed
  through from the candidate); no Google Books call is added.

### No prices — what ships instead

For every paid row: vendor name, "Check price →" button. The retailer shows
the live price at click time; we show none. This satisfies DMCC Act 2024
(s.226/227 — no invitation-to-purchase accuracy risk), Amazon's comparison
and client-cache rules (no Amazon affiliate in-app), and every store's terms.

## Android implementation notes

- `@capacitor/app-launcher` is explicitly **not** used for launch (no
  setPackage/extras); it may be used for `canOpenUrl` parity checks in
  tests, not at runtime.
- `AndroidManifest.xml` gains `<queries>` (4 packages + 1 BROWSABLE/VIEW
  https intent) in `android/app/src/main/AndroidManifest.xml`; no permission
  additions; sideloaded APK unchanged in every other respect.
- The WebView never renders store pages; known Capacitor pitfalls
  (`intent://`, `_blank`, `shouldOverrideUrlLoading`) are documented in ADR
  034 / the research doc; routing goes through the plugin, not through
  navigation.
- Unit tests cover the pure layer: URL parsing/registry matching, Dexie
  upsert/dedupe, child-gate filtering of the rows/cards, disclosure-cue
  presence per commissionable row (snapshot of rendered rows), LibriVox-match
  threshold behaviour on the existing pure matcher.
- E2E: Discover sheet renders rows for an adult profile; rows absent for a
  child profile; "Check price" tap fires the plugin (mocked in the WebView,
  asserts `launchIntent` called with expected url/package); paste-URL add of
  an Audible URL creates a store-badged card; the card launches Audible; add
  → remove round-trip.

## Data protection (GDPR) — assessment

This feature adds **no personal-data processing**:

- External items are device-local, never transmitted, never logged.
- Buy links are client-side URL launches; no clicks, referrers, tokens or
  identifiers are sent to our server; affiliate tokens identify *our* account,
  not a user. ISBN/URLs are not personal data.
- LibriVox lookup is served by `/api/buy-context`: identifiers only
  (title/author — non-personal, like every enrichment call already documented
  in `docs/roa.md`/`docs/processors.md`), never logged, never persisted,
  cached 5 minutes in memory, no query string recorded.
- No new retention rows; erasure/export are unaffected (external items are
  the user's own local data, outside server records); no DPIA trigger; the
  privacy notice is extended with one sentence: "The app can show links to
  book stores. Purchases made through links marked 'Ad' may earn the app a
  commission. No information about your tap is sent to us or to the store."

If a server-side click/redirect tracker is ever proposed, it must come with:
RoPA row (Art. 6(1)(f), balancing test), ≤90-day TTL, no profileId in
affiliate tokens (Apple/Amazon rules), and its own ADR — out of scope here.

## Acceptance criteria

- [ ] An Audible URL pasted into "I own this elsewhere" creates a library card
      badged Audible; the card's primary action opens the Audible app on the
      book (device matrix: Audible installed / uninstalled →
      Play-Store fallback, open browser).
- [ ] Google Play Books, Kobo and Libro.fm URLs parse and add the same way
      (one test per store; table-driven over the registry).
- [ ] External items are absent from the server entirely (integration test:
      no API request contains store URLs/external ids; server DB unchanged).
- [ ] External items cannot be played/downloaded/synced; no progress UI exists
      on their card or detail (component test + copy assertion).
- [ ] Discover sheet (adult profile) shows: LibriVox "Free" when matched;
      paid rows all rendering "Check price →"; every commissionable row
      carries the "Ad · we may earn a commission" cue adjacent to the button.
- [ ] Child profile: the sheet and "I own this elsewhere" are not rendered
      (spec 38 gate; E2E with a child session).
- [ ] With all `AFFILIATE_*` config unset, everything renders and works,
      untagged.
- [ ] No price text, "lowest", "was/now", or comparison framing appears in any
      render of the sheet (copy test).
- [ ] PWA build shows the same rows; launch falls back to Custom Tab there.
- [ ] `docs/roa.md`/`retention.md` unchanged; privacy notice sentence added.
- [ ] LIMITATIONS gains a spec-39 entry (no playback/progress, link-out only).

## Explicitly out of scope / deferred

- Any Amazon or Apple commission surface (PWA/Amazon: own change with counsel;
  Apple live price: deferred — iOS-only attribution, questionable value in an
  Android household app).
- Share-sheet (`ACTION_SEND`) ingest — fast-follow against this spec.
- Kobo/Audiobooks.com affiliate *price feeds* (approval-gated) and Libby
  (partner agreement) — new ADR when/if pursued.
- Position note/sync for external items — deferred per ADR 034 §2.
- Web/PWA purchase surface for Amazon (Creators API) — separate change.

## Checks

- Unit: registry parser table tests (valid/invalid per store), Dexie upsert
  + dedupe, child-gate rendering, disclosure cue per row, untagged mode.
- Component: sheet renders per profile; external card affordances.
- E2E: adult vs child sheet; paste-URL add/remove; plugin `launchIntent`
  invocation on tap (mock).
- Manual (device matrix, required for A): Audible/Play Books/Kobo/Libro.fm
  installed vs not; Android 12/13/15; API-level disambiguation observed.
