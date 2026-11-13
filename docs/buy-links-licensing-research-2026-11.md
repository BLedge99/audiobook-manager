# Buy-Links / Price Display / Affiliate Licensing Research — 2026-11

**Status:** Research report, not legal advice. General information compiled from primary sources (ToS, regulator guidance, statutes, case law) current as of 2026-11-13. Where a question turns on facts, agreement-specific interpretation, or unsettled law, it is flagged **NEEDS COUNSEL**. Which claims below are settled vs unsettled is summarized in §10.

**Scope:** A household Android app (and web client) that (a) shows buy-links with prices for audiobooks from multiple retailers, (b) deep-links into retailer apps (`ACTION_VIEW` / Android App Links), (c) adds client-side "external" library items, and (d) optionally shows affiliate-disclosure copy. Retailers in scope: Amazon.com/Audible, Apple Books/iTunes Store, Google Books/Play Books, LibriVox/public-domain sources, and other retailers via affiliate networks. Target markets: UK, EU, US.

**Method:** Primary-source fetch of: Amazon Associates Operating Agreement (rev. 2025-10-15) & Program Policies (rev. 2026-04-14), Google APIs Terms of Service & Google Books APIs ToS, Apple Services Performance Partners docs & iTunes Search API terms, FTC Endorsement Guides FAQ, ASA adviceOnline, UK DMCC Act 2024/CMA207, LibriVox, hiQ v. LinkedIn, Toyota v. Tabari. Secondary sources (press, law-firm notes) used only where labelled.

---

## 1. Amazon Associates / PA-API — the actual price-display rules

Sources: [Associates Program Operating Agreement](https://affiliate-program.amazon.com/help/operating/agreement) (rev. 2025-10-15); [Associates Program Policies](https://affiliate-program.amazon.com/help/operating/policies) (rev. 2026-04-14); Audible: [audible.com/ep/affiliates](https://www.audible.com/ep/affiliates) (confirms Audible runs through Amazon Associates, no standalone program).

### 1.1 Who may participate at all
- Associates may monetize "online software application" as a Site — but client-side software applications are heavily restricted (see 1.4).
- **Unsuitable Sitemask (§"Participation Requirements §1"):** sites/apps "(f) are directed toward children **or knowingly collect, use, or disclose personal information from children under 13** … or violate any applicable laws … relating to child protection (e.g., COPPA — 15 U.S.C. §§ 6501–6506) …". A household app that is arguably "directed toward children" risks rejection/termination of the Associates account. **NEEDS COUNSEL** whether a household app with child profiles (spec 38) is "directed toward children" for Associates purposes. (See §9.)
- Links must be **Special Links** with the Associates tag (`tag=xxxx-20`). Encourage bookmarking is banned; Special Links must link directly to Amazon Sites, and price/link in the app **must be served by Creators API / PA API** (see below).

### 1.2 Prices — may you show a price?
**Yes, but only in two narrow ways** (Participation Requirements §2(b), rev. 2026-04-14, verbatim):

> "Product prices and availability may vary from time to time. Because prices … may change, your Site **may only show prices and availability if: (a) we serve the link in which that price and availability data are displayed, or (b) you obtain Product pricing and availability data via Creators API or PA API** and you comply with the requirements regarding use of Creators API or PA API in the License."

- **(a) "We serve the link"** = SiteStripe-style "Get link with price" products / Amazon-hosted widgets where Amazon itself serves the price (e.g., banner/widget, not feasible for native UI).
- **(b) PA API / Creators API** = programmatic price, subject to the License.
- **A manually copied price, an ISBN-price scraped from the product page, or a third-party price feed is never permitted** — scraping is prohibited (License §, "may not use data mining, robots, or similar data gathering and extraction tools"; Prohibitions generally).
- **Comparison display rule (§2(b) addition):** if you display prices in any "**comparison**" format together with prices from non-Amazon sources (exactly our feature), you **must display both the lowest "new" price and, if provided, the lowest "used" price** at which the product is available on the Amazon Site. Displaying only a competitive headline price, or the lowest used price when Amazon provides one and you omit it, is a compliance failure.
- **Price tracking/alerting:** "your Site must not have price tracking and/or price alerting functionality" (§2(y)) — no watchlist-price-drop notifications.
- **No deceptive claims** about price/availability/policies (§2(b)).
- **Limitations on Liability** (Agreement §8): liability capped at 12 months' commission; **Disclaimers** (§7): all AS-IS.

### 1.3 Caching / freshness — the 24-hour rule (IP License §2(h), verbatim key text)
> "… you will not store or cache Product Advertising Content consisting of an image, but you may store a link to Product Advertising Content consisting of an image for up to 24 hours. You may store other Product Advertising Content … for caching purposes for up to **24 hours**, but if you do so you must immediately thereafter **refresh and re-display** … by making a call to Creators API, PA API or retrieving a new Data Feed and refreshing … on your application immediately thereafter. Unless otherwise notified by us, you may store individual ASINs for an indefinite period until termination … **if your application includes a client application, the client application may not store or cache Product Advertising Content**. Upon our request you will, within three business days, furnish us with a copy of any client application …"

Key consequences:
- **Server-side 24 h max caching is lawful only if you re-fetch immediately after.** In practice: show prices only from a fresh PA API call; never render an old stored price, and **do not persist Amazon prices in the DB beyond 24 h**, and even then only as a transient cache with immediate refresh.
- **Client-side (Android) storage/caching of Product Advertising Content is prohibited outright.** An Android app that stores Amazon images/prices in the local library DB or cache for later display is non-compliant, period. Any display of Amazon price/imagery in the client must be fetched/refreshed from your server (which proxies PA API live, and itself ≤24 h) or fetched live by the client — but the client must not store it.
- **Date/time-stamp requirement (License §2(i)):** if you obtain pricing/availability from Data Feeds or call the API **less frequently than hourly**, you must include a date/time stamp adjacent to the price, e.g. "Amazon.com Price: $32.77 (as of 01/07/2008 14:11 PST– Details)"; during the same day you may omit the date and use e.g. "as of 14:11 EST". You must also include (adjacent, or via link/pop-up) this verbatim-adjacent disclaimer: **"Product prices and availability are accurate as of the date/time indicated and are subject to change. Any price and availability information displayed on [relevant Amazon Site] at the time of purchase will apply to the purchase of this product."**
- ASINs may be stored indefinitely.

### 1.4 Mobile/client rules (Commission Income Statement §2(h) + Mobile Application Policy, rev. 2026-04-14)
- A purchase via a Special Link in a **Mobile Application that is not an "Approved Mobile Application", or in an approved app where the link was not served by Creators/PA API or other linked tooling Amazon makes available, is disqualified** (no commission).
- **Approved Mobile Application** requires ALL of: (a) available in Google Play / Apple / Amazon app stores; (b) free to download, Amazon links accessible without paying; (c) original content; (d) does not emulate Amazon's shopping app; (e) **must not host or render Amazon web pages in WebViews**.
- **Our household Android app — if sideloaded, or if it renders Amazon pages in a WebView, or if it is not free — can never be an Approved Mobile Application, and Amazon in-app Special Links would be non-qualifying.** This is the single biggest Amazon constraint on the feature. A web/PWA surface is the compliant path for Amazon links; a Play-store-distributed, free, original-content household app could apply, but the "directed toward children" suitability question (§1.1(f)) would then bite. **NEEDS COUNSEL.**
- The same policy bans client-side apps linking to Amazon Sites except Approved Mobile Applications; television/WebView framing banned.

### 1.5 Mandatory disclosure (Agreement §5, verbatim)
> "You must clearly and prominently state the following, or any substantially similar statement previously allowed under this Agreement, on your Site …: **'As an Amazon Associate I earn from qualifying purchases.'** … You will not misrepresent or embellish our relationship with you (including by expressing or implying that we support, sponsor, or endorse you)."
- Violation of §5 is **deemed a material breach** (§6) → immediate termination right + forfeiture of accrued commissions.
- Placement: "clearly and prominently … on your Site or any other location where Amazon may authorize your display" — every page/screen showing Special Links should carry it (e.g., footer + adjacency to buy UI); burying it in Terms does not satisfy "prominently".

### 1.6 Geo-targeting
- Schedule 1 of the Operating Agreement lists **one Amazon Site per locale** (e.g., US → amazon.com; other locales → their own Schedule). The agreement fetched is the **amazon.com** one; Amazon.co.uk / amazon.de etc. have **their own Operating Agreements/Program Policies with local disclosure requirements (e.g., UK: "As an Amazon Associate I earn from qualifying purchases" also applies under the .co.uk agreement — check the local agreement; the UK Localized equivalent language is materially the same English sentence, but the EU agreements carry local-law disclosure requirements (e.g., German Impressum expectations) and local arbitration clauses).**
- In practice you need a **separate Associates account per locale** (tags are per-locale, e.g. `tag=xxxx-21` for UK) and PA API is region-pinned (access per locale); an Associates account tagged for amazon.com earns nothing for amazon.co.uk purchases. Do not show USD/amazon.com prices to UK users with a US-only tag — you'll earn $0 and mis-state local currency prices.
- Cross-border link: Special Link to amazon.com from a UK audience shows US prices/currency — lawful but misleading for price display; use locale-specific tags (or the Amazon Shopping app/URL locale redirection the user agent lands on — Amazon does redirect, but you lose attribution and possibly violate the comparison rules).

### 1.7 Non-compliance consequences
- Agreement §2: commission payments may be permanently withheld **without notice**, whether or not related to the violation.
- §6: termination for convenience on 7 days' notice; **immediate** termination for material breach (which includes §5 disclosure breaches and any Program Policy breach), reputational risk, deceptive/fraudulent/illegal use, prior termination of affiliated accounts, suspension of tax-collection concerns.
- License §1: IP License terminates automatically on any non-timely compliance.
- Disputes (Schedule 2): binding AAA arbitration, Washington State/federal law (for amazon.com site); no class actions.
- Practical effect: loss of affiliate status + forfeited commissions + removal duty for Program Content.

### 1.8 Amazon.com vs Audible.com
- **Audible has no separate affiliate program**; it is promoted through Amazon Associates. Audible-specific commissions are typically **bounty-style** (e.g., AU$/US$ fixed bounty on free-trial sign-ups) rather than a % of sale, governed by the same Operating Agreement/Policies. Same disclosure, same Special Link rules, same 24-h/price rules. Links to Audible audiobooks are Amazon Sites for attribution purposes (Audible.co.uk through the UK Associates agreement, etc.).
- Distinguish the **Audible Creator / ACX** programs (for narrators/rights holders) — irrelevant to this feature.

**Bottom line for Amazon:** a household Android app can link out to Amazon/Audible only if it qualifies as an Approved Mobile Application (Play-distributed, free, original content, no WebView of Amazon) — otherwise use the **web/PWA client** for Amazon buy-links, server-proxy prices via PA API with ≤24 h refresh + adjacent disclaimer + date stamp, display Amazon's lowest new (and if given, used) price in any comparison view, keep no Amazon content on the client, tag per locale, and carry "As an Amazon Associate I earn from qualifying purchases." prominently.

---

## 2. FTC (US) and ASA/CAP (UK) — affiliate links in apps

### 2.1 FTC — Endorsement Guides (16 CFR Part 255, rev. 2023) + "What People Are Asking" (current FAQ) and .com Disclosures (staff guidance, rev. 2013)
Sources: [FTC business guidance](https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking); [16 CFR Part 255](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-B/part-255); [.com Disclosures PDF](https://www.ftc.gov/sites/default/files/attachments/press-releases/ftc-staff-revises-online-advertising-disclosure-guidelines/130312dotcomdisclosures.pdf).

- Affiliate links are endorsements: "if the message isn't an advertising message by or on behalf of a marketer, it isn't an endorsement" — a commission link **is** an advertising message. Section 255.5 requires a **"clearly and conspicuously"** disclosed material connection. The 2023 definition of "clearly and conspicuously" (§255.0(f)): "a disclosure is clear and conspicuous **only if it is easily noticeable (i.e., difficult to miss) and easily understandable by ordinary consumers** … in the same medium, same language, same cadence, with as much visual/audible prominence as the communication; communicated as close as practicable to the claim/endorsement to which it relates."
- **Proximity/adjacency**: "the guiding principle is that it has to be clear and conspicuous. **The closer the disclosure is to your recommendation, the better.**" A disclosure and the link it covers should be visible together; a single review with disclosure + link on the same screen = adequate; separated = not.
- **"Buy" buttons and link labels**: "Is 'affiliate link' by itself an adequate disclosure? … **a 'buy now' button would not be adequate.**" "'Paid link' right next to an affiliate link should be an adequate disclosure." "'Commissionable link' is probably not a clear disclosure." Practically: label the link/button itself, e.g. **"Paid link" / "Ad" / "We may earn a commission"** adjacent to the buy action, not a footer-only legend. A lone Amazon sentence in an "About" screen would not fix an unlabeled buy button.
- **No special mandated wording** ("no special wording … simple, like 'This is an ad for BRAND'"), but it must be unambiguous and in the same medium (visual disclosure for visual link, audible for audio). "#ad", "Ad:", "Advertisement" are fine.
- **Children**: "children and teens … disclosures will not work for younger children"; be "particularly careful" with endorsements directed at children. (§9.)
- **Apps**: same rules as any medium — disclosures must be difficult to miss on the screen showing the link; a "before you tap out" interstitial with an "Ad · we earn a commission" line is strongly advisable because passive inline labels can be missed. ASA-type bottom disclaimers alone would likely fail "difficult to miss".

### 2.2 ASA / CAP (UK)
Sources: [ASA adviceOnline — Online Affiliate Marketing](https://www.asa.org.uk/advice-online/affiliate-marketing.html) (22 Mar 2023); [CAP Code rule 2.1/2.3](https://www.asa.org.uk/type/non_broadcast/code_section/02.html); rulings cited therein.

- Affiliate content is marketing under CAP Code scope I.h. ("directly connected with the supply…") and treated as an ad in full when the whole content concerns affiliate products; where content is mixed, the affiliate parts and links must be identifiable as advertising (**Matalan Retail Ltd t/a Matalan, 30 Oct 2019; BPerfect Ltd, 21 Jul 2021; associated MailOnline ruling 29 Dec 2022; Coco Shine 27 Jun 2018**).
- Rule **2.1**: marketing communications must be **obviously identifiable as such**. Rule **2.3**: clear commercial intent if not apparent from context. Both advertiser and affiliate are responsible regardless of who created the ad.
- Labelling: "Ad" / similar identifier adjacent to the affiliate content is the accepted route. The ASA's labelling research found **"*affiliate" alone not understood by consumers** (Asos ruling, 22 Apr 2020) — so "affiliate link" copy alone is not Safe ASA practice either; use an unambiguous identifier ("Ad"). Bottom-of-post disclaimers are "**unlikely to be sufficient**" because links may be encountered before them; generic/ambiguous wording such as "may earn a commission" without highlighting which content is advertising was judged insufficient (MailOnline). Clear statement tied to the specific links is the standard.
- ASA recommends identifying affiliate content at the point of encounter; voucher/deal sites must be obviously advertising to any visitor — do not rely on About/FAQ pages.
- Note: ASA/CAP is non-statutory but backed by CMA referral; the DMCC Act 2024 enforcement (10% global turnover fines, CMA207) now applies in parallel (§5).

### 2.3 Practical disclosure spec for this app
1. Every screen with a commissionable link: an inline "Ad · we may earn a commission" (or "Ad") tag **adjacent to the buy button**, plus a short verbal disclosure in any spoken/audio context.
2. Amazon-specific sentence: "As an Amazon Associate I earn from qualifying purchases." in footer/legal + ideally near Amazon prices.
3. Do not rely on a standalone "Affiliate" or "Commissionable link" label; do not bury disclosure in terms; do not make the disclosure post-tap only.
4. Child profiles (if any): no commission links, or parent-gated behind an adult gate (§9).

---

## 3. Google Books API — terms, prices, attribution

Sources: [Google Books APIs — Terms of Service](https://developers.google.com/books/terms) (last modified 2012-04-25); [Google APIs Terms of Service](https://developers.google.com/terms) (last modified 2021-11-09) incl. Data Portability; [Books API Volume resource — saleInfo](https://developers.google.com/books/docs/v1/reference/volumes).

### 3.1 Fees / non-commercial clause
Google Books APIs ToS §1 (Fees, verbatim): "**You may not charge users any fee for the use of your application**, unless you have entered into a separate agreement with Google or obtained Google's written permission."
- The household app is free and no separate agreement exists → unpaid use OK; charging users for the app that uses Books API would breach. (Buy-links/commissions are not "charging users"; they are monetization, not a user fee. Still flag: if the app is ever monetized as paid download via Play, §1 is breached; **NEEDS COUNSEL** on whether affiliate revenue constitutes "obtaining money".)
- No quota in the Books ToS itself; the Google APIs ToS §2(d) allows Google to set/enforce quota limits; Books API historically ~1,000 queries/day unauthenticated. Enforce a server-side quota budget + LRU cache.

### 3.2 Attribution / branding
- Books ToS has **no explicit "Google Books logo" requirement**. The overarching Google APIs ToS §6 (Brand Features): use only per documentation; display any attributions required by documentation; **attribution required by Google must be displayed**; no claim of partnership/endorsement (§6(c)); use under Brand Features Use Guidelines; if using Google Books content visually, "Powered by Google"-style attribution as documented applies to some Google APIs (e.g., Custom Search "powered by Google"); for Books API there is no badge requirement in the ToS fetched — but prudent practice is a visible "Book data from Google Books" line on coverage/attribution screen. **Display source attribution**; do not imply Google endorses the app.
- §5(e) Prohibitions on Content (Books metadata, covers, saleInfo): may not "**Scrape, build databases, or otherwise create permanent copies** of such content, or keep cached copies longer than permitted by the **cache header**"; may not "Copy, translate, modify, create a derivative work of, sell, lease, lend, convey, distribute, publicly display" beyond the API purpose; may not **misrepresent the source or ownership** or **remove/obscure copyright notices**.

### 3.3 May you store prices (saleInfo)?
- `saleInfo` (incl. `retailPrice` / `listPrice`, country-dependent) is API content subject to §5(e): **no permanent copies**; keep cached copies only as permitted by cache headers; no wholesale database of Google prices. A short-lived server-side cache (hours–days) of saleInfo solely to render a "check price" affordance is defensible; a permanent price-history table is not. Do not build price graphs from Google data.
- **SaleInfo is about purchaseability in the Google eBookstore, not a general-market price feed.** There is no API contract granting use "for commerce comparison" as a licensed redistribution right; it is licensed for use in your application to display book info/purchaseability, not resold or redistributed as a dataset. Using it to render a price comparison against Amazon/Apple with affiliate tags is not explicitly prohibited by the ToS text, but it is not an authorized "commercial feed" either; treat it as **reference data with live refresh at click-time**, attribute it to Google Books, and prefer a **"Check price" click that links out** (with zero stored price) over a displayed stored price. Flag for counsel if commercial-scale.
- Section 2(d) quota + §5(e) mean: server-side fetch, short TTL, no bulk harvesting; anything else risks suspension under §3(a) monitoring.
- Privacy note: Books ToS §3 (Privacy) concerns user submissions to Google (name/nickname in reviews) — we don't submit user names; standard.
- Controller-Controller DPA: Google APIs ToS §2(i) incorporates [Google Controller-Controller Data Protection Terms](https://privacy.google.com/businesses/gdprcontrollerterms) where GDPR applies — no personal data is sent by us to Books API for price lookup (ISBN/title only) → no DPA trigger in practice.

**Practical spec:** server-side only; cache ≤ 24 h (or cache-header compliant); render "Price from Google Books (may be stale)" or omit stored price and use "Check price →" (click-time link to books.google.com/Play Books product page with affiliate query string if linking program used). No Google trademarks in app icon/name; visible attribution line.

---

## 4. Apple — iTunes Search API and Apple Services Performance Partners

Sources: [performance-partners.apple.com/program-overview], [/commissions-payments], [/linking], [/linking-policies], [/faq], [/search-api] (all fetched 2026-11); [developer.apple.com — Changes for apps in the EU](https://developer.apple.com/support/apps-in-the-eu/); Apple newsroom (Aug 2026 unified EU terms, 5% Core Technology Commission replacing Core Technology Fee); DMA context: European Commission press release IP/24/3433 (prima facie breach of Art 5(4) anti-steering).

### 4.1 iTunes Search API (public, unauthenticated)
- No auth; ~**20 calls/minute** (subject to change); JSON; `media=audiobook`, `entity=audiobook`, `lookup?isbn=` supported; `country` storefront param; returns `trackPrice`/`collectionPrice`, `trackViewUrl` (affiliate-tokenizable link), `artworkUrl100`, explicit flags.
- **Legal (verbatim core):** promotional content ("Promo Content": previews, artwork, App icons) may be used only to promote the content itself; must (i) be placed only on pages promoting that content, (ii) be **proximate to an approved "Download on iTunes/App Store" badge** linking to purchase, (iii) carry "provided courtesy of iTunes" if song/music-video previews included, (iv) be streamed not downloaded/cached, (v) not used as standalone entertainment, (vi) not used to promote other goods/services. Promo Content "as is", no warranties; forward claims to Apple; remove on request; CA law governs.
- Practical: **hotel-style display of Apple prices from the Search API is not itself prohibited** — the API is the sanctioned integration point and Apple documents "large websites should set up caching logic" (i.e., caching is contemplated). But prices are storefront-specific; always set `country=` to the user's storefront; prices change; no SLA. Do not put iTunes previews/artwork in a generic catalogue UI without adjacency to the purchase badge and correct country storefront. Use in an Android app: **the "Approved badge" requirement effectively forces iOS-style UI treatment; on Android the purchase button must deep link to the iTunes/Apple Books URL (below), not an in-app purchase of audio.**

### 4.2 Apple Services Performance Partners (the affiliate program)
- **Commission:** Apple Books **7% on sales** (TV/Movies also 7%); one-time membership bounty for Music/TV+; 30-day cookie; $30 min payout; 60–90-day cycle; 60 currencies/Partnerize; threshold auto-selfbill $30.
- **Device support: Apple Books & Apple Podcasts track on iOS, iPadOS, macOS ONLY — not Android, not Windows.** Apple Music/TV links also track on Android/Windows.
- **CRITICAL for this project:** an Android household app using an Apple Books affiliate token gets **zero attribution** on Android (Apple Books has no Android client store to attribute). Apple Books buy-links are therefore informational only on Android; commission attribution requires the click path to resolve on an Apple device (e.g., link opened on iPhone/iPad/Mac, or Universal Links into Apple Books app). Also note **the user must have an Apple device** for the purchase link to convert meaningfully.
- **Link construction:** `at=` affiliate token (Partnerize), `ct=` campaign param (≤40 chars; no user/device identifiers — **no user IDs, IDsFA/Android IDs, click IDs allowed**), `ls=1` (Music only), `geo.` prefix only for Music; Apple Books links must be generated via the **Apple Books Toolbox** (manual keying discouraged); single `?`; lowercase params.
- **Deep links:** links open the Apple Books app via Universal Links (AASA) when installed, else the web storefront. **"Powered by" requirements:** Promo Content must be proximate to an approved badge; artwork needs "courtesy of iTunes" attribution where audio previews used; partner links rel=nofollow for web SEO; **clear & conspicuous disclosure of commercial interest as required by local law** (linking-policies page, verbatim: "Program partners must also clearly and conspicuously provide disclosure of any commercial interests as required by local or foreign regulation for affiliate links."). No user-level tracking; you may not embed user/device identifiers in `ct=`.
- Application is selective ("limited number of partners who can drive volume and quality"); no personalized agreements; account must show an app link / site.

### 4.3 EU DMA and Apple
- DMA (Reg (EU) 2022/1925) Art. 5(4) forbids gatekeepers from preventing steering to cheaper offers. Apple's EU business terms changed through 2024–2026: alternative app marketplaces, alternative payment processors, out-of-app promotion of offers (reader apps may promote out-of-app offers **without an actionable link**, or with Entitlement `StoreKit External Purchase Link Entitlement` + ExternalPurchaseCustomLink API disclosure sheet on iOS 26.2+); Aug 2026 announcement: **Core Technology Commission 5%** replacing Core Technology Fee; EC preliminary findings (IP/24/3433) that App Store steering rules breach Arts. 5(4)/6(3).
- **Relevance to this project:** only if an iOS/iPadOS wrapper of this household app is shipped **in the EU** and links out for Apple Books/in-app content — then external-purchase links/steering fall under the EU terms (no Apple commission on physical goods or purely consumption links, but Apple-side entitlements/disclosure sheets apply to digital content purchases steered in-app). For an **Android app in the UK/EU/US selling audiobooks of other retailers**, Apple's IAP regime is irrelevant; physical goods and consumption-only links out are not Apple "digital goods" IAP either. The DMA also indirectly legitimizes external link-outs generally. **NEEDS COUNSEL** if/when an iOS EU build links to paid audiobook purchase in-app.

**Bottom line for Apple:** iTunes Search API = legitimate for catalogue/price display (live, `country=`, courtesy attribution, no stored full copies, cache lightly); Performance Partners = **not viable for commission on Android** (Books tracks iOS/iPadOS/macOS only) — treat Apple Books links as plain deep links, attribution only on Apple devices, disclosure per local law, Toolbox-generated links only.

---

## 5. EU/UK consumer law — accuracy of advertised prices

### 5.1 UK (retained EU law, now DMCC Act 2024)
- **Consumer Protection from Unfair Trading Regulations 2008** → revoked/replaced by **Digital Markets, Competition and Consumers Act 2024 (DMCC Act), Part 4**, in force for UCP from **6 April 2025**. CMA guidance **CMA207** (Unfair Commercial Practices) + **CMA209** (Price Transparency). CPUTRs are no longer the operative instrument.
- Prohibitions relevant to buy-links: **misleading actions** (s.226), **misleading omissions** (s.227; including omission of material information in an **"invitation to purchase"** — s.229/230: product characteristics + **total price** incl. fees/taxes + arrangement for payment are material information; omission is banned regardless of transactional-decision effect), **aggressive practices** (s.228), Schedule 20 banned practices (32; incl. drip pricing practices and fake reviews), **professional diligence** backstop (s.225(4)).
- **An invitation to purchase** is any commercial practice giving indication of product characteristics + price. Our buy-link screens are exactly that. If the displayed price is stale and omits the total price or the availability caveat, the omission is per se unfair; if materially misleading, likely s.226.
- **Enforcement:** CMA can fine up to **10% global turnover**; private redress (consumer may unwind contract/sue for discount) via s.240/Sch.24 DMCC Act.
- **Price comparison specifically:** CTSI *Guidance for Traders on Pricing Practices* (businesscompanion.info) — comparisons must compare **like with like** (same edition/format/condition); comparison with a different edition = misleading; "lowest price" claims must be true at the time of the ad and substantiated; reference prices must reflect genuine prior prices; drip-pricing of fees banned. UK **Prices Act 1974** + **Price Marking Order 2004** still govern selling-price indications by traders (unit price rules for some goods).
- **Consumer Rights Act 2015** — quality/remedies for the audiobook purchase itself (trader-facing); not price-advertising law but relevant to copy on the retailer side; also CRA digital content chapter applies to the purchase of digital content (audiobooks) if we sold anything (we don't).
- EU: **UCPD 2005/29/EC** as amended by **Omnibus Directive (EU) 2019/2161** (in force 2022; added digital-market transparency + individual remedies + stricter penalties ≥4% turnover ≥€2m); **Price Indication Directive 98/6/EC** (selling price + unit price indication); **Comparative Advertising Directive 2006/114/EC Art. 4** — comparative ads lawful only if objective, like-for-like, not misleading, not discrediting, and not creating confusion with marks; **Omnibus 2019/2161** also amended UCPD Art. 7 (invitation to purchase) to crystallize what material info (incl. total price/address/geo) must be given. Consumer Rights Directive 2011/83/EU — information duties only where we are the seller (we are not).
- **Accuracy duty in practice:** a price shown in-app is an invitation to purchase; it must be *accurate at the time shown* and re-checked; showing a stored stale price while implying "this price" is available invites liability (UK: s.226/227 DMCC Act + CMA209; EU: UCPD Art. 6/7). There is **no safe harbour for "price may have changed" asterisks** if the wrong price is shown prominently (ASA precedent above confirms the ad itself is non-compliant; asterisks don't cure).

**"Check price" re-fetch at click-time is the safer architecture** — never display a stored absolute price as if current; show "Check price →" that deep-links and lets the retailer show the live price (retailer is the trader, accuracy duty sits there). If you do display a price: (1) live PA-API/fetch at render; (2) date/time stamp + Amazon-required disclaimer adjacency; (3) treat as misleading omission risk if >24 h stale; (4) comparison columns must be like-for-like editions and include Amazon's used price if provided.

### 5.2 GDPR angle — ISBN + click to retailer
- **ISBN is not personal data** (product identifier; identifies the *edition*, not any individual). Price/click metadata keyed to nothing is not personal data either. **Art. 6 GDPR is therefore not engaged for the ISBN lookup itself.**
- **What can be personal:** server-side click logging keyed to `profileId` (household member) = personal data (Art. 4(1) — an identifier tied to an individual). Also click + IP + UA forwarded as part of the outbound redirect is, for the retailer, *their* data processing, not ours — but if **we** log "user X clicked buy at time T", that's ours and it's personal.
- **Client-side ACTION_VIEW:** app hands a URI to Android; the OS opens retailer app/site; no PII passes from us except the ISBN-derived URL (e.g., `https://www.audible.co.uk/pd/…`). Retailer processes IP/UA under its own terms/consent banner. We are not a joint controller of that flow. No consent needed from us.
- **Server-side redirect/click-tracker:** if we log or count clicks, do it **without storing profileId** (aggregate counters or short-TTL rows). If ever keyed, lawful basis = **Art. 6(1)(f) legitimate interests** (accuracy of affiliate reporting, fraud prevention), with balancing test, minimum retention, opt-out in privacy notice. Do **not** send profileId in affiliate `ct=`/sub-tags — Apple forbids user identifiers in `ct=`, Amazon forbids associating sub-tags with users.
- **GDPR Art. 2(2)(c) household exemption:** processing in the course of a purely personal/household activity is outside GDPR. A *strictly domestic* household deployment could argue it; but this project is being productionized, has child profiles, and repo GDPR docs already treat it as in-scope — **do not rely on the household exemption for a shipped product**. Keep the repo posture (RoPA entries, retention schedule).
- **ePrivacy / PECR:** linking out and letting the **retailer** set cookies on its own site after navigation = retailer's PECR problem (its consent banner). **We** set cookies or tracking pixels on *our* app/site only if we embed tracking — in-app WebView framing of retailer pages (which Amazon forbids anyway for Approved apps) or embedding an affiliate-network pixel — then **PECR reg. 6 consent** is required for non-essential cookies (affiliate/analytics pixels). Recommendation: **no embedded trackers**; pure link-out. UK ICO cookie guidance is consistent.
- **PECR/ePrivacy for user devices after click:** if the retailer stores an affiliate cookie on the user's device via our redirect, that's the retailer's storage, and the user encounters it on the retailer's domain; standard third-party-cookie norms apply to the retailer, not to us.

**Consent: none required for link-out itself; none for ISBN lookup (not personal data); consent (or at least Art. 6(1)(f) + notice + TTL) only if you log profile-tied clicks; no new special categories; no Art. 9 data; no Art. 35 DPIA triggered on these facts alone** (see §8).

---

## 6. Deep linking — legality and trademark limits

### 6.1 Is `ACTION_VIEW` / App Links into a retailer's public product page lawful? Generally yes.
- A deep link is a **hyperlink, not scraping**: the user initiates the navigation; no data is copied into our system; no login, no bypassing of access control. The hiQ framework (below) concerns *access to data*, which deep linking does not perform.
- **hiQ Labs, Inc. v. LinkedIn Corp.**, 938 F.3d 985 (9th Cir. 2019), vacated on other grounds 141 S. Ct. 2752, and reaffirmed 31 F.4th 1180 (9th Cir. 2022) (post-Van Buren): accessing **public, unauthenticated pages** is not "without authorization" under CFAA "gates-up-or-down" analysis; terms-of-service prohibitions don't convert public access into unauthorized access. (Caveat: final 2022 district judgment was a $500k consent judgment for breach of the user agreement after all — contract, not crime.) Deep links to public product pages are at least as benign as hiQ's facts re: public data access, and stronger re: no data acquisition at all.
- **EU:** no CFAA equivalent; database right (Dir. 96/9/EC) protects *extraction/re-utilization*, not linking; linking is generally lawful (see e.g., CJEU case-law on hyperlinks, *Svensson* (C-466/12) and *GS Media* (C-160/15): linking to works freely available with rightsholder consent is not a "communication to the public"; deliberate links to unauthorized copies can be). Retailer product pages are offered openly with an "Affiliate" intention or at least no access control — deep linking is standard commerce practice (Amazon's own Associates program is built on it).
- **Android mechanics:** `ACTION_VIEW` + `intent-filter`/App Links (`autoVerify`) with retailer's Digital Asset Links; if the retailer app is installed and handles its public URL scheme/App Links, link opens in-app; otherwise browser. Neither requires retailer permission — **but** per §1.4/§4.2, *functionality* may be constrained (Amazon: only Approved Mobile Applications may link; and such links must be PA/Creators API served, i.e., server-tagged).
- **Where it crosses the line:**
  1. **Implied partnership/endorsement** — UI/copy implying "official partner", "Audible® exclusive", "get it here" branded buttons that suggest sponsorship (Lanham Act §43(a), 15 U.S.C. §1125(a) — false designation / misleading affiliation; UK/EU passing off & unfair competition; ASA/CAP and FTC deception risk too).
  2. **Trademark use beyond nominative fair use** — e.g., "Audible®" as a section heading in the app, or using logos.
  3. **Framing/WebView** — rendering retailer pages inside the app (Amazon bans; Chapter 2 privacy capture issues; also `X-Frame-Options`/AASA bypasses). Don't.
  4. **Interposing pages/paras** — redirecting through our own intermediate "ad page" to inflate clicks = Redirecting Link disqualification (Commission Income Statement §2(e)) and misrepresentation.
  5. **Bypassing purchase flows** — deep links are fine; intercepting or auto-filling checkout, or "auto-adding to cart" via intents, would violate retailer ToS and potentially law.
  6. **Scraping the page the link opens** — we never see its content; do not fetch/parse it server-side for "price fill".

### 6.2 Trademarks in UI: nominative fair use
- **US – nominative fair use** (*New Kids on the Block v. News America Publishing*, 971 F.2d 302, 308 (9th Cir. 1992); *Toyota Motor Sales, U.S.A. v. Tabari*, 610 F.3d 1171 (9th Cir. 2010); KP Permanent, 543 U.S. 111 (2004) re: two-step separation): permitted when (1) the product is not readily identifiable without the mark; (2) only as much of the mark as reasonably necessary is used; (3) nothing suggests sponsorship or endorsement. Plain-text retailer names ("Buy at Audible", "View on Amazon") with no logos, no ® styling games, and no "official/partner/exclusive" wording satisfy all three. Using the mark as your own app's branding or in a domain/app name would fail factor 2/3.
- **UK – Trade Marks Act 1994 s.10(6):** use of a mark to identify/refer to goods as those of the proprietor is not infringement "in accordance with honest practices in industrial or commercial matters"; s.10(4)(b) comparability; comparative advertising must comply with the comparative-ad rules (s.10(6)(b) incorporates honest-practice test). **EU – Directive (EU) 2015/2436 (recast TM Directive) Art. 14** + UCPD/Omnibus comparability rules — same triad.
- **Passed off/partnership confusion:** avoid logos; if displaying retailer logos, ensure license (Amazon Trademark Guidelines explicitly forbid use of logos/brand material except as supplied Program Content with Special Links + Guidelines; Apple Promo Content rules analogous). **Cheapest safe route: plain text names + "Ad" labels; no logos.**

---

## 7. LibriVox / public-domain audio — what "Free download" commits you to

Sources: [librivox.org/pages/public-domain](https://librivox.org/pages/public-domain/); [Project Gutenberg License](https://www.gutenberg.org/policy/license.html); [archive.org](https://archive.org) (public-domain audio collections; individual item licences vary).

### 7.1 LibriVox
- LibriVox records **only texts public domain in the USA**; **all recordings are donated to the public domain** (US). Book summaries and catalog cover art likewise public domain (US). No permission needed; selling/broadcasting/remixing allowed; credit appreciated but not required.
- **Caveats:**
  - **Country dependence:** a recording PD in the US is not necessarily PD elsewhere — e.g., in the EU/Switzerland, works may be protected for **life+70** (Dir. 2006/116/EC) even if pre-1930 US-PD; and **related/neighbouring rights** in sound recordings (EU: 50 years for phonograms, e.g. §85 German UrhG; 70 for certain recordings) are separate from the underlying work's copyright. German/Italian/etc. users should check local status. **LibriVox itself recommends non-US users check copyright status in their country before downloading.** Our app is household; still flag EU users.
  - **Underlying work vs recording vs translation:** translations are new works (copyright runs from translation publication); a US-PD Dickens translated in 1950s EU is **not** PD in the EU. Displaying "free audiobook" for an edition that's not PD in the user's country → they may download infringing material; you'd be facilitating (low risk, but note it).
  - **Project Gutenberg trade-mark:** if you distribute/display "Project Gutenberg™"-branded texts, the Gutenberg License trademark rules apply: don't charge for copies w/o permission; retain notices. LibriVox audio of PG texts ≠ PG trademark use, but don't imply "Project Gutenberg approved".
  - **No warranty:** recordings donated PD "as is"; LibriVox doesn't warrant legal status in every jurisdiction; audio quality/abridgements vary. Your "Free download/Listen" is a **courtesy link to a third-party file**, not a warranty of availability, legality in the user's country, or fitness. Say exactly that in copy + terms; availability/issues are upstream (archive.org hosting; LibriVox feed).
  - 1529/1930 rolling US cut-off: works published pre-1930 (as of 2026) US-PD; rolling annually (Music Modernization Act etc. aside). LibriVox page still says "published before 1923" but the catalog policy is practically pre-1930; cite the live page not the vintage FAQ.
- archive.org public-domain audio: PD status flagged per item ("Public Domain Mark"/CC0 + US rules); each item's license must be checked individually; linking is fine, embedding/download mirroring inherits nothing.

### 7.2 Displaying a "Free download" link commits you to:
Nothing legally — it's a link. Practically: (1) **accuracy copy**: say "public-domain recording hosted by LibriVox/archive.org; legal status varies by country"; (2) **no warranty** in your terms; (3) **no implied claim** that *all* items in a LibriVox feed are legal in the EU (they may not be); (4) don't re-host or strip source attribution; (5) LibriVox asks only for courtesy credit — give it ("Source: LibriVox"), it's free goodwill and consistent with API usage norms.

---

## 8. GDPR / RoPA impact for THIS project

Repo patterns checked: `docs/roa.md` (Record of Processing Activities, Art. 30), `docs/retention.md`, `docs/dpia.md`, spec 38 (child accounts), `GDPR-AUDIT.md` (external metadata lookups = legitimate interest, ISBN/title only).

### 8.1 If the app sends ISBN/clicks **client-side** (ACTION_VIEW)
- No personal data leaves our infrastructure except the URL fragment (ISBN-derived, non-personal). Retailer processes IP/UA/cookies on its domain under its own notice/consent. We log nothing new. **RoPA: no change. Lawful basis: n/a (processing out of scope for us). Consent: none. DPIA: none.**
- Recommended default.

### 8.2 If **server-side** redirect with click logging
- New processing activity: "Affiliate click-through logging" — personal data if tied to profileId/IP; otherwise anonymous aggregate.
- **RoPA entries to add** (pattern of `docs/roa.md`): activity name; purpose (affiliate attribution audit, support, fraud); data categories (event time, mediaItemId/ISBN, retailer code, optional profile pseudonym); **lawful basis Art. 6(1)(f) legitimate interests** (document balancing test; alternative Art. 6(1)(a) consent if you want profiling — don't); retention (recommend ≤90 days, TTL purge; or aggregate-only with zero profile join); recipients (server only); cross-border (retailer locale, IP transfer — list); ADM none.
- **Don't** send profileId/userAgent/IP to retailer; don't add user identifiers to affiliate tokens (Apple forbids; Amazon forbids sub-tag/user join).
- **GDPR household exemption note** (Art. 2(2)(c)) doesn't change repo posture; keep in-scope treatment.

### 8.3 Server-side price fetch (PA API / Google Books saleInfo / iTunes lookup)
- ISBN/title/coverage-only queries: catalogue metadata, not personal (consistent with GDPR-AUDIT.md row). **No personal data to processors; no consent; lawful basis Art. 6(1)(f) or contract 6(1)(b).** Add RoPA row if not already: "External retailer/price lookups — legitimate interest — ISBN/title/ASIN only — not personal data — server only".
- If caching Amazon PA-API price server-side, no demand on GDPR but **Amazon License rules** (§1.3) still forbid client persistence; keep server TTL ≤24 h + refresh. Apple/Google caches short.
- **DPIA (`docs/dpia.md`)**: not required — no Art. 9 data, no large-scale monitoring, no profiling, low risk, no innovative tech. Add a screening paragraph if privacy notice mentions affiliate links (GDPR Art. 13(1)(e) recipients). UK: ICO AADC overlay if under-18 users (§9).
- **Consent summary:** none for ISBN lookup; none for link-out; (f)+notice for optional click logs; PECR consent only if you embed non-essential cookies/pixels (don't); child-specific consent not available as substitute for parental controls (§9).
- **Data-subject rights/erasure:** click logs keyed to profiles must be erasable/exportable with the rest of the profile export; keep them out of exports if aggregate-only, or include if tied.
- **No new Art. 9 special-category data. ISBN ≠ personal data. No children's data beyond existing spec-38 categories. No DPIA trigger.**

---

## 9. Children — purchase links for kids (spec 38)

### 9.1 US — COPPA (15 U.S.C. §§ 6501–6506; 16 CFR Part 312)
- Applies to operators of online services/apps **directed to children under 13** or with **actual knowledge** of under-13 users collecting/using/disclosing personal info.
- Affiliate links/commissions are not "collection of personal information" by us if zero PII flows client-side; but **targeted advertising to under-13s requires verifiable parental consent** (behavioral); contextual link-outs are lower risk yet still "marketing" content for FTC/AADC purposes. FTC Endorsement Guides + COPPA both treat kids as not understanding disclosures (research: "disclosures will not work for younger children").
- **Amazon Associates suitability (f):** sites directed at children under 13 or violating child-protection law are unsuitable — household app with prominent child profiles is a real risk to the Associates account. **NEEDS COUNSEL**; safest: no Amazon Special Links visible to child profiles.
- Safest COPPA posture: **no commissionable links for child profiles**; links only in adult profiles; parental PIN gate to any purchase outbound.

### 9.2 UK/EU — Age Appropriate Design Code (UK ICO, "Children's Code", 2020) + EU Audiovisual/AVMSD & UCPD + national rules
- AADC (applies to information society services likely accessed by **under-18s**; household apps included):
  - **Best interests of the child** test; **high privacy by default**; **profiling off by default** (and no profiling "unless compelling reason"); **nudge techniques ban for harmful effect** (SR 13 — buying pressure on kids); geolocation off; clear, age-appropriate privacy information ("If you are likely to be accessed by children, you must provide age-appropriate information"); **detrimental use of data** prohibited (SR 14: data must not be used in ways detrimental to children).
  - Buy-pressure UI aimed at children (big animated "BUY!" badges on child profiles) is exactly what AADC discourages; compliance = no affiliate upsell to child profiles at all, or strictly parent-gated.
  - ICO expectations: age-appropriate transparency + parental controls where the service processes data of under-13s (ICO position) — mirror your spec 38 design.
- EU: UCPD as amended by Omnibus (2019/2161) — aggressive practices; AVMSD Art. 9 (ads to children must not directly exhort purchase); German JMStV/Jugendmedienschutz for commercial communications to minors; Dutch/Belgian rules similar. Buy buttons targeted at under-children → arguably "direct exhortation" territory. Audiovisual media services rules for on-demand catalogues if marketed to kids.

### 9.3 Design requirements (concrete)
1. **Child profiles: default OFF** — no buy links, no prices, no affiliate tags, or a single neutral "Ask a grown-up" row.
2. **Adult profiles only** for affiliate buy flows (spec 38 role gating).
3. **Parent gate** (PIN/biometric — existing spec 28 machinery) before any outbound purchase link is shown or opened from a child session; log the parental action, not the child's interest.
4. No marketing push/notification of affiliate offers; no price-drop alerts (also Amazon §2(y) ban).
5. No commission on links **denominated as for children**; disclose commission on adult purchase UI as in §2.3.
6. Retailer app deep links opened from child UI still show retailer's own UI — parental gate applies to the tap itself.
7. Verify Amazon account suitability if children profiles are "directed toward children" — **counsel**.

---

## 10. Summary — compliance checklist & what's settled vs needs a lawyer

### 10.1 Settled (low legal risk, follow the rules)
- Deep linking/`ACTION_VIEW`/App Links into **public** retailer product pages is lawful (hiQ principle; hyperlink ≠ scrape; CJEU linking case-law). No permission needed from retailer for plain links.
- ISBN lookup is not personal data; no GDPR consent needed for metadata lookups (ROPA pattern already in repo).
- LibriVox/Gutenberg free audio: courtesy links lawful; keep attribution + country caveat; no warranty.
- Plain-text retailer names ("Buy on Amazon", "Listen in Apple Books") = nominative fair use (US) / s.10(6) honest practice (UK) / Art. 14 (EU) — provided no logos, no partnership implication.
- FTC/ASA: disclosure adjacency is mandatory; "Buy now"/"affiliate link" alone insufficient; use "Paid link"/"Ad · we may earn a commission".
- 24-h refresh + adjacency disclaimer + date stamp for any shown Amazon/Google price; no prices without PA API / "we serve the link"; comparison = lowest new (+used if given).
- Apple Books affiliate ≠ usable on Android; iTunes Search API prices OK with courtesy attribution, live-ish display, storefront-correct.
- Link-out with retailer-set cookies = retailer's PECR/GDPR issue; we set none.
- Google Books: free use OK; **no fees**; attribution; no permanent copies; short TTL.
- Content liability: we don't host/redistribute retailer audio; "consumption-only" pattern fine.

### 10.2 NEEDS COUNSEL (before shipping affiliate/price features)
1. Amazon Approved Mobile Application eligibility for a household, possibly child-directed, sideloaded/Play app + suitability "directed toward children" determination (§1.1, §1.4, §9).
2. Whether affiliate revenue breaches Google Books ToS §1 "no fees" (arguable; Google has never enforced against free apps with buy-links, but it is untested).
3. Apple EU external-purchase entitlements/disclosure sheets + Core Technology Commission if/when an iOS EEA build steers digital audiobook purchases.
4. UK/EU consumer-law characterization of displayed prices (invitation to purchase; CMA209/UCPD Art. 7; DMCC Act s.226/227/229/230) — counsel sign-off on "Check price" vs displayed-price copy; misleading-omission analysis of Amazon used-price display rule; CMA 10% turnover exposure.
5. Trademark clearance of any proposed in-app retailer branding; passing-off analysis for UK/EU.
6. Children: COPPA/AADC/UCPD/EBA exhortation analysis for household child profiles; parental-gate sufficiency; Amazon suitability interplay.
7. Any contract/valuation review before signing Operating Agreement, Partnerize T&Cs, or running Skimlinks/Awin; US tax withholding (W-9/W-8BEN) for Associates.
8. GDPR: whether click-log keyed to profiles stays within Art. 6(1)(f) balancing + RoPA entry sign-off; DPIA screening; if production EU footprint grows, ePrivacy consent-mode for any embedded pixels (avoid).
9. Terms/privacy notice/data-subject-rights updates (export/erasure of any click logs; retention in `docs/retention.md`).
10. Play Store distribution question: Google Play Payments policy — digital goods you can't consume inside the Play app (audiobooks consumed in retailer apps, not in this app) are **out of scope** for Play Billing; external buy-links to such goods are generally permissible, but the EU EEA "External Offers"/"Billing Choice (from 30 Jun 2026, UK)" programs and US "ECL" framework apply if you ever sell/enable checkout **in-app** — counsel if scope expands beyond pure consumption link-out.

### 10.3 Shipping checklist (engineering + legal flags)
**Architecture**
- [ ] Prices **never stored long-term**; server-side live fetch; TTL ≤ 24 h; immediate re-fetch after cache expiry; client carries no Product Advertising Content (Amazon rule).
- [ ] Adjacent to each buy button: price (if shown) + date/time stamp + Amazon/Google disclaimer text (or link) + **"Ad · we may earn a commission"** (FTC/ASA) + Amazon's exact sentence in legal/footer.
- [ ] Comparison view shows **lowest new price + lowest used price (if provided)** on any Amazon column — never cherry-pick.
- [ ] Compare like-for-like edition/format/condition only; label retailer of each column; "Prices accurate as of …" timestamp.
- [ ] Prefer "**Check price →**" re-fetch/deep-link over stored prices (legally safest UX).
- [ ] No price tracking/alerting; no watchlist-drop push notifications.
- [ ] No embedded WebViews of retailer pages (Amazon Approved-app rule; UX and privacy).
- [ ] Links tagged **per locale** (Associates tag per country; `country=` for iTunes API; locale of storefront); no cross-geo prices shown as "the price".
- [ ] Apple links only from Apple devices / expect $0 attribution on Android; iTunes API prices fetched live; storefront-correct; courtesy attribution "courtesy of iTunes" near previews.
- [ ] `ACTION_VIEW`/App Links with correct public retailer URLs; no intermediate redirect pages; single `?` in partner links; `rel=nofollow` on web; no user/device identifiers in `ct=`/sub-tags.
- [ ] No retailer logos/marks beyond plain-text names (or obtain license); no "official/partner/exclusive" copy; app icon/name independent of retailer marks.
- [ ] Server click logs (if any): no profileId or aggregate-only; ≤90-day TTL; RoPA row; purge on erasure; in DSR export or excluded-by-design.
- [ ] RoPA/privacy notice updated: affiliate disclosures, recipients (retailers), purposes, retention; DPIA screening noted in `docs/dpia.md`; retention schedule updated.
- [ ] No PII to retailer; no account linking; no sub-tag→user join.
- [ ] Child profiles: buy UI absent/default-off; parent-gate (PIN) required; no affiliate tags; "Ask a grown-up" copy only; records for spec 38 consistency.
- [ ] Amazon application/agreement review before going live; locale agreements; PA API access (sales qualification required — Amazon requires qualifying sales to keep API access); Apple Partnerize application (selective, expect rejection or delay).
- [ ] Legal: privacy notice + T&Cs updated (affiliate nature, no affiliation with retailers, pricing disclaimer, country PD caveat for LibriVox); refund/return stays with retailer (say so).
- [ ] Accessibility/honesty: disclosure visible without scrolling on buy screen; no dark patterns ("Buy Now (best price!)" claims banned unless substantiated at that moment).
- [ ] Operational: PA API quota budget; failure mode = hide price, keep "Check price →" (never show stale as current); monitor Associates suspension emails; annual review of agreements (they change ~yearly, Amazon April, Google/Apple ad-hoc).

### 10.4 What a lawyer must do vs what is settled
**Settled, follow the checklist:** link-out legality; no PII for ISBN/clicks; disclosure adjacency rules; 24 h price freshness; PD audio linking; nominative use of plain-text marks; no embedded trackers w/o consent; not showing Amazon content in a non-Approved app; no child affiliate links default.
**Counsel required (do not self-serve):** Amazon suitability (children!), Google Books "no fees" characterization, CS/EEA terms for any Apple/Google in-app external purchase flow, DMCC Act/UCPD invitation-to-purchase opinion for displayed price copy, trademark/passing-off clearance, child-directed COPPA/AADC sign-off, contract review before accepting Associates/Partnerize, tax W-forms, GDPR Art. 30/35 sign-off if logging clicks, Play Payments policy if scope expands.

---

### Source index
1. Amazon Associates Program Operating Agreement (rev. 2025-10-15) — https://affiliate-program.amazon.com/help/operating/agreement
2. Amazon Associates Program Policies (rev. 2026-04-14) — https://affiliate-program.amazon.com/help/operating/policies (Commission Income Statement; Participation Requirements §1–6; Products Statement; Mobile Application Policy; Trademark Guidelines; IP License §2(h) 24-h caching, §2(i) date/time stamp)
3. Audible affiliates — https://www.audible.com/ep/affiliates (runs via Amazon Associates)
4. Google Books APIs ToS (2012-04-25) — https://developers.google.com/books/terms ; Google APIs ToS (2021-11-09) — https://developers.google.com/terms ; Books API volume/saleInfo — https://developers.google.com/books/docs/v1/reference/volumes
5. Apple Services Performance Partners — https://performance-partners.apple.com (program-overview; commissions-payments: Books 7%, iOS/iPadOS/macOS only; linking: at=/ct=/ls=1, Apple Books Toolbox; search-api: 20 calls/min, audiobook media, isbn lookup; linking-policies: disclosure duty; faq: no user identifiers in ct=, selective applications)
6. iTunes Search API Legal terms (Promo Content, courtesy of iTunes, badge adjacency) — https://performance-partners.apple.com/search-api
7. Apple EU DMA changes — https://developer.apple.com/support/apps-in-the-eu/ ; https://developer.apple.com/support/payment-options-on-the-app-store-in-the-eu/ ; EC IP/24/3433; Apple newsroom 2026-08 unified EU terms (5% Core Technology Commission)
8. FTC Endorsement Guides FAQ — https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking ; 16 CFR Part 255 (2023); .com Disclosures (2013)
9. ASA adviceOnline — Online Affiliate Marketing (2023-03-22) — https://www.asa.org.uk/advice-online/affiliate-marketing.html ; CAP Code r.2.1/2.3; rulings: Matalan (A19-1020138), BPerfect (G21-1110608), Asos (A19-1025856), MailOnline (G22-1153503), Coco Shine (A18-444165), Matalan TL Blog
10. UK DMCC Act 2024 Pt 4; CMA207 Unfair Commercial Practices; CMA209 Price Transparency — https://www.gov.uk/government/publications/unfair-commercial-practices-cma207/unfair-commercial-practices ; CTSI Guidance for Traders on Pricing Practices (businesscompanion.info); Technical note on UCPs (2025-04-04); ASA news 2025-04-08 (rule changes post-DMCCA)
11. EU UCPD 2005/29/EC + Omnibus 2019/2161; Price Indication Dir. 98/6/EC; Comparative Advertising Dir. 2006/114/EC Art. 4; Price/misleading-omission practice; Directive (EU) 2015/2436 Art. 14 (TM); TMA 1994 s.10(6) (UK)
12. hiQ Labs, Inc. v. LinkedIn Corp., 938 F.3d 985 (9th Cir. 2019); 31 F.4th 1180 (9th Cir. 2022); Van Buren v. United States, 141 S. Ct. 1648 (2021)
13. New Kids on the Block v. News America, 971 F.2d 302 (9th Cir. 1992); Toyota Motor Sales U.S.A. v. Tabari, 610 F.3d 1171 (9th Cir. 2010); KP Permanent Make-Up v. Lasting Impression, 543 U.S. 111 (2004)
14. LibriVox — https://librivox.org/pages/public-domain/ ; Project Gutenberg License — https://www.gutenberg.org/policy/license.html ; archive.org (per-item licences)
15. ICO Age Appropriate Design Code — https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/ ; COPPA 16 CFR Part 312; spec 38 (this repo)
16. Google Play Payments policy — https://support.google.com/googleplay/android-developer/answer/10281818 ; US ECL / EEA External Offers / UK & EEA Billing Choice (from 30 Jun 2026) — secondary source (solidgate.com / appcharge.com summaries) — verify on Play Console before relying.

*This report is general research, not legal advice. Laws and platform terms change; primary sources linked. Nothing here overrides the repo's source-of-truth order (roadmap → specs → ADRs → LIMITATIONS). If this feature ships, add a spec and ROPA/privacy-notice updates in the same change.*
