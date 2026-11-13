# ADR 034 — External providers: deep-link out, never play, never store prices

## Status
Accepted 2026-11-13. Research: [`docs/external-providers-research-2026-11.md`](../docs/external-providers-research-2026-11.md); licensing detail: [`docs/buy-links-licensing-research-2026-11.md`](../docs/buy-links-licensing-research-2026-11.md). Spec: [`specs/39-external-providers.md`](../specs/39-external-providers.md).

## Context

The product should let a user who owns a book on Audible (or Kobo, Libro.fm,
Google Play Books) treat that book as part of this app's library, and should
answer the obvious question every Discover result raises: "where do I get this?"

The request was researched before any design was written (see the research
docs). The findings that drive this decision:

1. **No store exposes consumer-facing playback, library or progress APIs.**
   Audible has no developer surface for citizens, AAX audio is encrypted with
   account-specific activation keys, scoped storage hides store-managed files,
   and decrypting them breaches Audible's Conditions of Use and DMCA §1201.
   Google Play Books' consumer API is ebook-only, its `isbn:` search is broken
   platform-wide (Oct 2026), anonymous quota is zero, and the
   "My Library"/Classic surface it does offer is being retired 2026-11-18.
   Kobo, Libro.fm, Chirp, Storytel, Everand expose nothing official; OverDrive
   (Libby) is gated behind a signed per-library partner agreement.
2. **Prices cannot be stored or comparatively displayed.** A displayed price is
   an "invitation to purchase" (UK DMCC Act 2024, replacing the CPUTRs on
   2025-04-06; EU UCPD Art. 7 as amended by Omnibus 2019/2161): it must be
   accurate when shown, like-for-like, and refreshed. No vendor grants a
   storable price feed to third parties. Amazon's successor to PA-API
   (the Creators API; PA-API 5.0 returns 403) requires ≥10 qualifying sales in
   a trailing 30 days, a 1-hour refresh, a date/time stamp and adjacency
   disclaimer, forbids client-side caching of prices outright, and — for
   mobile — requires an **Approved Mobile Application** (Play-distributed,
   free, original content, no Amazon WebViews). Our sideloaded app can never
   meet that bar; only the web/PWA can, and only after affiliate
   qualification. Google Books `saleInfo` prices are ebook prices (the Play
   audiobook storefront's prices are not exposed by any API) and the ToS bans
   permanent copies.
3. **Link-out is lawful and is what the industry ships.** Deep links to
   public product pages are hyperlinks, not scraping (hiQ Labs; CJEU linking
   case-law; Amazon's own Associates program is built on this). Goodreads,
   The StoryGraph, Fantastic Fiction and boook.link all ship static
   ISBN/ASIN → retailer links with **no prices**. LibriVox is the one genuinely
   free, keyless, CC0 source of audiobooks.

## Decision

**Feature A (external library items) is a client-side-only, deep-link-out
integration. Feature B (Discover buy links) is a "check price" link-out
surface with one free row — never a live price-comparison table.**

1. External books live in a device-local `ExternalLibraryItem` store (Dexie),
   never on the server, merge into the Library view marked with their store,
   and are addable only through in-app entry of a store URL in v1.
   Streaming/playback/progress-sync of store content is an explicit
   non-goal, permanently: it is prohibited by every store's ToS and (for
   DRM content) by the DMCA.
2. No position/progress UI for external items in v1. There is no source for
   it (the store apps expose nothing; the one channel — notification access —
   reads *all* notifications and is rejected), and a manual text note was
   rejected as out of place. If a compliant, consented signal ever exists
   (e.g. a store-licensed Now Playing integration), a new ADR revisits this.
3. v1 stores: Audible, Google Play Books, Kobo, Libro.fm. The store registry
   (package name, URL templates, affiliate tokens) ships as in-app JSON
   config, updatable without a release; unknown stores degrade to "opens in
   browser".
4. Launch order for a buy/listen tap: explicit `ACTION_VIEW` with
   `setPackage(store)` → implicit BROWSABLE `ACTION_VIEW` with
   `FLAG_ACTIVITY_REQUIRE_NON_BROWSER` → Chrome Custom Tab. Detection via
   `PackageManager` + `MATCH_DEFAULT_ONLY`, backed by `<queries>` entries;
   `QUERY_ALL_PACKAGES` is not used. A ~50-line native Capacitor plugin
   (`canResolve`, `launchIntent`) backs this; plain `<a>` clicks and
   `@capacitor/browser` alone cannot setPackage or carry intents reliably.
5. Discover buy links in v1: **LibriVox "Free" row** (official API match on
   normalized title; link to LibriVox/archive.org listen/zip page; labelled
   source, no endorsement claim, PD-status-varies-by-country copy), then
   **Libro.fm, Bookshop.org, Barnes & Noble** (ISBN-keyed static links),
   **Kobo** (static HTTPS link), **Audible/Amazon** (untagged check-price
   link — no affiliate in the app) and **Google Play Books** (search deep
   link; no book-specific id is attainable, no price).
   Every vendor link carries the vendor's own price display at click time —
   we never display one.
6. Affiliate participation is **self-service programs only** (Libro.fm/Awin,
   Bookshop/Rakuten-typical, Kobo/Rakuten, B&N/Impact), i.e. tag where a
   program exists and shows value, and only if configuration is supplied; the
   app must work fully untagged. **No Amazon affiliate anywhere in the app**;
   Amazon buy links are untagged. An Amazon/PWA affiliate surface is a
   separate future decision (spec + ADR + counsel), because the Creators API's
   ≥10-sales qualification, 1-hour refresh rule, date-stamp disclaimer and
   Approved-Mobile-Application bar cannot be met by this app, and the
   comparison-display rule (lowest new **and** used price) would apply the
   moment an Amazon price is shown beside other vendors'.
7. Disclosure is part of the feature, not a wrapper: an inline
   "Ad · we may earn a commission" tag adjacent to every commissionable buy
   button (FTC 16 CFR Part 255 — "affiliate link" and "buy now" are not
   adequate cues; ASA/CAP: same adjacency requirement, "Ad" identifier); the
   mandated Amazon sentence is out of scope (no Amazon affiliate in-app);
   commission disclosures also live on the Discover buy-link surface footer.
8. **Child profiles (spec 38) see no buy links, no prices, no affiliate
   tags.** Addresses the FTC position on children, the ICO Children's Code
   (no detrimental use / no buying pressure), and Amazon's suitability rule
   should Amazon ever be reconsidered. Implementation: the existing child
   gate hides the whole "Get this book" affordance.
9. **No personal data leaves the device; one identifiers-only server call.**
   Links are templates, tokens are build-time config. ISBN/URLs are not
   personal data; the client-side link-out passes no identifiers to the
   retailer. Because librivox.org sends no CORS header, the only server
   dependency is `GET /api/buy-context?title=&author=` — a single cached
   (5-minute TTL), deadline-bound LibriVox lookup, identifiers only, no DB
   writes, never logged — plus an ISBN passthrough already present on the
   Discover candidate payload. We log nothing; RoPA/retention/DPIA are
   unchanged in substance (spec 39). A future server-side click tracker would
   need its own change: RoPA row, Art. 6(1)(f), ≤90-day TTL, no profileId in
   affiliate tokens — explicitly out of scope here.
10. No scraping, ever, for prices or availability (every store's terms +
    DMCC Act exposure + brittleness).

## Consequences

- v1 is small and honest: a Dexie store, a registry module, one native plugin
  with two methods, one identifiers-only server lookup (`/api/buy-context`),
  ~6 URL rows on the Discover sheet, spec-38 gating on the child session.
  No DB migrations; the only server change is that one read-only route.
- The app will ask users to paste store URLs; that is deliberate v1 friction.
  Share-sheet ingest (ACTION_SEND) is the designed fast-follow.
- We publish zero prices. Users see "Check price →", which is what every
  comparable product ships; support load from "the price is wrong in the
  app" cannot exist because the app shows none.
- If audience/qualification for Amazon or Kobo price feeds ever materialises,
  it arrives as a new ADR against this one, with counsel in the loop.

## Alternatives considered

- **In-app playback of store content** — impossible (ToS, DMCA, DRM, scoped
  storage, no SDK). Rejected permanently.
- **Reverse-engineered store APIs** (audible-cli et al.) for library/progress —
  ToS breaches, fragile, reputational risk. Rejected.
- **Vendor price APIs with affiliate approval** (Kobo Rakuten feeds,
  Audiobooks.com API v2, Apple iTunes Search API) — Apple's row is iOS-only
  attribution and is out of v1; Kobo/Audiobooks.com are approval-gated and
  out of v1; iTunes live price is deferred. All four can be added later as
  rows against this ADR without redesign.
- **Amazon affiliate in the app** — Approved Mobile Application bar cannot
  be met; sideloaded app; child-profile suitability risk. Rejected for the
  app; PWA path deferred to its own change.
- **Periodic server-side price fetch + cache** — violates every store's ToS
  or the
  DMCC Act accuracy rule once shown; Amazon's 1h/client-cache rules make the
  client display illegal regardless; and it implies logging/refresh
  infrastructure this app doesn't want. Rejected.
- **OverDrive/Libby integration** — no public id-minting API; requires a
  signed partner agreement per library and patron auth. Absent a library
  partnership, permanently out.
- **Manual "where I left off" free-text note for external items** —
  rejected by product: out of place with the rest of the UI and a chore
  nobody updates.
