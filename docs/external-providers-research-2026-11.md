# External providers ("buy & borrow" links / external library items) — research — 2026-11

> Research report, **not legal advice** and **not a plan**. Compiled 2026-11-13 from official documentation, live API probes, and verified platform behaviour. Companion specialist report: [`buy-links-licensing-research-2026-11.md`](buy-links-licensing-research-2026-11.md) (licensing/legal in depth). No code changes accompany this document; the next step after decisions are made is an ADR + spec, per `AGENTS.md`.

## The two sub-features, restated

- **A — External library items.** A user who owns a book on Audible (or Kobo, Libro.fm, …) can add that book to the app's library, **client-side only** — it never touches our server. Tapping it opens the book in the corresponding store app.
- **B — Discover price comparison.** The Discover tab offers per-book links: "free via LibriVox", or "purchase at vendor X (price shown)", and clicking takes the user to the book's page in that vendor's app/site to buy.

---

## Verdicts up front

| Ask | Verdict | Why (evidence below) |
|---|---|---|
| A: play Audible/Play Books/Kobo/Libby audio **inside** our app | **Not possible**, legally or technically | AAX/Play Books DRM + no SDK + ToS + scoped storage |
| A: show "external books" in the library, deep-link out | **Feasible, recommended** | Client-side items + App-Links/ACTION_VIEW + `<queries>` + native Capacitor plugin |
| A: know the user's position in the store app (progress sync) | **Not possible** via API; optional NotificationListener heuristics at best | No store exposes progress; notification access is a huge privacy surface — spec 38 posture argues against |
| B: show a **live price** per vendor | **Mostly not possible**. Only Apple (iTunes Search API, free/keyless) today; Amazon Creators API only if we become an "Approved Mobile Application" (our sideloaded app can't) | See §B |
| B: "Check price →" link that lets the retailer show the live price | **Feasible and the industry standard** | Goodreads / StoryGraph / boook.link all ship static affiliate links, zero prices |
| B: LibriVox "free download" row | **Feasible, zero auth** | Official CC0/public-domain API |
| B: price *comparison* table with stale stored prices | **Do not build** | UK DMCC Act 2024 / UCPD: a displayed price is an invitation to purchase; stale prices are per-se unfair; Amazon comparison-display rules; no vendor lets you store prices |

---

## A — External library items (client-side, deep-link out)

### What doesn't exist (so we don't design around it)

- **No Audible API/SDK/OAuth.** No public consumer API for library, progress, or playback. `developer.audible.com` does not exist; Audible's presence on developer.amazon.com covers Appstore/Alexa/Music/LWA — no Audible scopes. Not even an "owned on Audible" entitlement check (Goodreads' Kindle-ownership badge is a closed Amazon-internal integration; the Goodreads public API was retired in 2020). [official checks]
- **No Play Books/consumer API.** Google Books API (`books.google.com`, key required since anonymous quota was zeroed in late 2024, ~1,000/day, `isbn:` search broken platform-wide as of Oct 2026) returns **ebook** `saleInfo` only — no audio format, no narrator, no audiobook ISBNs. "My Library" (`mylibrary/bookshelves/1`, Purchased shelf) is ebook-modelled, requests a write-capable scope, and **Classic My Library is retired 2026-11-18** with no replacement API announced. Not viable, and a poor GDPR look (write scope for a read feature).
- **No Kobo / Libro.fm / Chirp / Storytel / Everand consumer API.** Libro.fm's internal API is reverse-engineered only. Libby requires an OverDrive **partner agreement** (per-library, patron auth, build review) — not available to a normal third-party app. Hoopla similarly gated.
- **In-app playback of store purchases:** AAX is encrypted with account-specific activation keys, files are unreadable via scoped storage, and decrypting is both ToS-barred (Audible Conditions of Use) and DMCA §1201-barred. Play Books audio is app-bound. Libby is ODM/Adobe DRM. This wall has no compliant route. (DRM-free files — Libro.fm, Downpour, LibriVox — can be imported through the normal scanner, which already handles MP3/M4B.)

### What works (the architecture)

1. **Client-side `ExternalLibraryItem`** (IndexedDB/Dexie, like the replica): `{ id, store, title, author, narrator?, externalId (ASIN/…), coverUrl?, httpsUrl, packageName, addedAt, userNote?, lastPositionLabel? (free text) }`. Never sent to our server; merged into the Library list on render with a store badge. Optional later: encrypted backup/sync via existing profile machinery, always marked `origin:'external'`.
2. **Store registry as JSON config** shipped in the app (updatable without release): per store — package name, search/product URL templates, App-Link support, fallback Play Store package URL. Initial set: Audible, Google Play Books, Kobo, Libro.fm, Libby (if we can mint `share.libbyapp.com/title/<id>` URLs), Bookshop.org, Downpour.
3. **Native Capacitor plugin (~50 lines Kotlin)** with two methods: `canResolve({url, package}) → boolean` (PackageManager + `MATCH_DEFAULT_ONLY`) and `launchIntent({uri, package?, chooserTitle?}) → {completed}`; falls back implicit → Custom Tab (`@capacitor/browser`). `@capacitor/app-launcher` exists but does only package detect + plain VIEW (no `setPackage`, no extras) — not sufficient. Manifest gains `<queries>` (packages + one VIEW/BROWSABLE/https intent); no `QUERY_ALL_PACKAGES`.
4. **Launch order:** tap → explicit `ACTION_VIEW` + `setPackage(store)` → on `ActivityNotFoundException`, implicit BROWSABLE with `FLAG_ACTIVITY_REQUIRE_NON_BROWSER` → on failure, Custom Tab. Audible App Links are **verified** (`audible.com/.well-known/assetlinks.json`, HTTP 200, `com.audible.application{,.samsung,.universal}`) so `https://www.audible.com/pd/<slug>/<ASIN>` opens the app directly; elsewhere setPackage + https is the reliable route. Uninstalled store → "Get <store> on Play" fallback + browser.
5. **Ingestion flows:** (a) paste a store URL in the app → host → store, id → item; (b) **share sheet into our app** (`ACTION_SEND`, `text/plain`, parse URL from `EXTRA_TEXT`); (c) manual add with search-by-title deep-link.
6. **Honest labelling:** cards say "Opens in Audible ↗" — never imply playback. Progress = free-text note the user maintains. Optional v2: opt-in NotificationListenerService "now playing" heuristic — flag it, disclose it, default off (it reads all notifications; spec 38/GDPR posture makes this a hard call to accept).

### Device verification owed before ship

Per store, on 2–3 devices (API 33/34/35): package name correctness, App-Link vs setPackage vs browser routing, fallback chain, share-parse edge cases, `<queries>` effectiveness, Android 15 re-verification caching. See the technical appendix in the research notes (Capacitor plugin shape, pitfalls, 12-item test list).

---

## B — Discover price comparison

### The honest constraint

A displayed price is an **invitation to purchase** (UK DMCC Act 2024 / EU UCPD Art. 7 as amended by the Omnibus Directive): it must be accurate at the time shown. No vendor gives us a storable, re-displayable price feed. Therefore:

- **Never store/render a stale absolute price.** The compliant pattern everywhere is **"Check price →"** (link out; retailer displays the live price, retailer is the trader, accuracy duty sits there).
- If we *do* display a price anywhere: live API fetch at render, date/time stamp + the adjacency disclaimer (Amazon requires the exact "accurate as of…" wording), like-for-like edition, refresh ≤ hourly for Amazon (1h Offers TTL) or accept the stamp+disclaimer burden, **never in the client** (Amazon bans client-side caching of Product Advertising Content outright).
- **No price tracking / drop alerts** (Amazon §2(y); also pointless).
- **Comparison-display rule:** if we show Amazon's price beside others, we must also show Amazon's lowest *used* price if provided — avoid "price comparison" framing and you avoid most of this.
- **Children (spec 38): no commissionable links for child profiles** (FTC: disclosures don't work for under-13s; Amazon Associates suitability "directed toward children" risk; ICO Children's Code: no detrimental use, no buying pressure). Adult profiles only; parent-gate any outbound purchase link from a child session.
- **Affiliate disclosure:** "Ad · we may earn a commission" adjacent to the buy button + the verbatim "As an Amazon Associate I earn from qualifying purchases." prominently + ASA/CAP "Ad" labelling (UK); "affiliate link" alone is not an adequate cue.
- **GDPR:** links/ISBNs aren't personal data; client-side link-out = no new processing. If we ever log clicks server-side: aggregate-only or ≤90-day TTL, Art. 6(1)(f), RoPA row, no profileId in affiliate `ct=` tokens. No DPIA trigger on these facts.

### Vendor-by-vendor buy rows (feasibility today)

| Row | Live price? | How | Notes |
|---|---|---|---|
| **LibriVox / archive.org** (free) | "Free" is the price | Official API, keyless, CC0/public-domain | "Free download" = courtesy link, no warranty, PD status US-centric (EU life+70 caveat); show "Source: LibriVox" |
| **Amazon / Audible** | Only via **Creators API** (PA API 5.0 is dead, 403s) | Needs Associates account + **≥10 qualifying sales / trailing 30 days**, OAuth; `GetItems(ASIN)` + `OffersV2` price; **1h TTL**, date/time stamp + disclaimer; **client may not cache any of it** | Kill-shot: **Approved Mobile Application** required for mobile affiliate links = Play-distributed, free, original content, no Amazon WebViews. **Our sideloaded app can never qualify.** → Amazon rows belong on the **web/PWA** surface only, or ship as untagged link-outs (no commission) |
| **Apple Books** | **Yes — free, keyless** iTunes Search API (`media=audiobook`, `collectionPrice`, `country=`) | Live fetch, courtesy attribution | Attribution/7% commission tracks **iOS/iPadOS/macOS only** — useless on Android. Row is informative; include it only if we want Apple-device users covered. ~20 req/min; cache ≥24h |
| **Google Play Books** | **No.** Books API saleInfo = ebooks only, `isbn:` search broken (Oct 2026), buyLink points to books.google.com not the Play audiobook page; Play audiobook ids (`AQAA…`) not attainable from any API | — | Ship "Buy on Google Play" as a **check-price deep link**: `play.google.com/store/audiobooks/details?id=…` (opens Play Store/Play Books on Android — both declare assetlinks) — but we can't get the `id` programmatically; fall back to `play.google.com/store/search?q=<title author>`. Zero price |
| **Kobo** | No public API; affiliate "regional data feeds and API access" exists but approval-gated (Rakuten Advertising, up to 6% audio) | Static HTTPS link `kobo.com/{region}/{lang}/audiobook/{slug}`; package `com.kobobooks.android` | Link-out only until affiliate approval |
| **Libro.fm** | No (`api.libro.fm` doesn't exist) | **ISBN-keyed**: `libro.fm/audiobooks/<isbn13>-<slug>`; app `fm.libro.librofm`; Awin affiliate (10% audiobook, 30-day cookie) | Best ISBN-keyed link-out; indie-bookstore positioning is on-brand |
| **Bookshop.org** (now sells audiobooks) | No | `bookshop.org/books/<slug>/<id>?ean=<isbn13>`; affiliate 10% (30% bookstores) | ISBN-keyed, good story for indies |
| **Barnes & Noble NOOK** | No | `barnesandnoble.com/w/<slug>/<id>?ean=<isbn13>`; Impact affiliate, ~2–4% | ISBN-keyed |
| **Audiobooks.com** (= Storytel now) | **Maybe** — real `api.audiobooks.com/api/v2`, key by email to `developersupport@audiobooks.com`; affiliate page promises "product feed via API … integrate an audiobook store on your site" | CPA is on trial sign-ups, not price feed | Cheap email to try; until key arrives, link-out only |
| **Downpour** (Blackstone) | No | Shopify product URLs; ~5–10% FlexOffers | DRM-free sales — pairs well with "import into scanner" upsell |
| **Chirp** | No; ephemeral deals — prices meaningless anyway | `chirpbooks.com/<slug>`; CJ affiliate 20% new / 5% returning | Link-out, no price |
| **Libby** | Partner-gated (per-library, patron auth, OverDrive build review) | `share.libbyapp.com/title/<id>` needs the OverDrive numeric id — which only partner APIs vend | **Skip for MVP.** Only if a library partnership happens |
| **Spotify / Everand / Storytel / Hoopla** | No prices anywhere | Skip | — |
| **Project Gutenberg** | N/A (no audio of its own; links out to LibriVox) | — | Cover via LibriVox row |

### What the industry does

Goodreads (Amazon-owned): outbound links, **no prices**. The StoryGraph: Bookshop links + "we earn commission", **no prices**. Fantastic Fiction, boook.link, Geniuslink: static ISBN→retailer links, **no live prices anywhere**. No consumer app found shows live audiobook prices across vendors. Our design should match: **affiliate-token static check-price links, one "Free" row via LibriVox, prices (if any) only from Apple/Amazon under the constraints above.**

---

## Cross-cutting conclusions

1. **Feature A is real and shippable** as client-side external items + deep-link-out. It is the only honest interpretation of "playing books from other apps": we never claim playback, we open their app.
2. **Feature B is a link-out feature with a LibriVox free row, not a price-comparison engine.** "Price comparison" as designed in the request (show prices inline, click price to buy) is achievable only for Apple (iOS-irrelevant on Android) and Amazon (non-qualifying app) — so the shippable design is "check price" buttons, affiliate-tagged, with the disclosure stack above, child profiles excluded.
3. **Affiliate participation is optional and gated.** Amazon = effectively web/PWA-only; others are self-service (Awin/Rakuten/CJ/Impact sign-up) but earn cents; decide explicitly whether to bother.
4. **GDPR/ROPA** gains one row only if we do server-side click logging (recommend: don't, or aggregate-only). No DPIA. Client-side link-out keeps the current posture.
5. **Licences to read in full before build:** Amazon Associates Operating Agreement + Program Policies (comparison display, client apps, ≥10 sales), Google Books ToS (no fees, no permanent copies), Apple Performance Partners linking policies, UK DMCC Act 2024 / CMA207 & CMA209 (invitation to purchase), FTC 16 CFR Part 255, ICO Children's Code.
6. **Prefer server-side nothing for B.** Everything can be client-side: static URL templates + affiliate tokens + (optional) live iTunes lookup. The household server doesn't need to change. If affiliate tags are added anyway, the web/PWA surface (not the sideloaded app) is where Amazon buy-links should live.

## Open decisions for the product owner

1. **Affiliate at all?** (a) no monetization — plain links; (b) self-service affiliate programs (Libro.fm/Bookshop/Kobo/B&N/Apple) with disclosure stack; (c) + Amazon on web/PWA only via Creators API (needs ≥10 sales/mo + counsel on "directed toward children" suitability — spec 38 child profiles).
2. **Apple Books row** — show price/link knowing Android users can't buy (iOS-only store) or omit?
3. **Google Play row** — "Buy on Google Play" with a search deep link (no `id` attainable, no price): include as plain link, or omit until a partner feed exists?
4. **Libby** — skip entirely, or pursue an OverDrive partner agreement (only with a participating library)?
5. **Feature A scope** — Audible + Play Books + Kobo + Libro.fm for v1; Libby/Bookshop/Downpour later? And: free-text position note only (recommended), or opt-in Now-Playing listener?
6. **Amazon in v1 at all** — even as an untagged link-out ("Buy on Audible" without commission, zero affiliate burden, still needs no WebView/caching)?
7. **Consent to store affiliate tokens in-repo** — public repo? tokens in config vs build-time env?
8. **Spec/ADR numbering** — if approved, this becomes roadmap item 39 + spec 39 + ADR 034 (Android native plugin + external items) and ADR 035 (price-link policy: no stored prices, check-price pattern, child exclusion).

## What this research does not cover

- Real-device App-Link behaviour per store version (needs hardware).
- Kobo/Audiobooks.com feed approval (needs applications).
- Counsel sign-off on the flagged items in `buy-links-licensing-research-2026-11.md` §10.2 (Amazon child-suitability, Google Books "no fees", DMCC opinion, trademark clearance — plain-text nominative use is settled, logos are not).
- Crawler/scraping approaches — **rejected by design** (ToS + DMCC + brittleness).
