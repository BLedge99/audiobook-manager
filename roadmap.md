# Roadmap

Ordered. Each item has a finish line — that's the definition of done. Each item
has a matching spec in `specs/`.

> **What does not work yet, and what is planned:** see
> [`LIMITATIONS.md`](LIMITATIONS.md). Read it before estimating anything that
> touches enrichment, narrators, covers or search.

| # | Feature | Finish line |
|---|---------|-------------|
| 01 | Scanner consolidation | One canonical scanner module; duplicate `services/scanner.ts` removed; tests green |
| 02 | Test infrastructure | `npm test` runs backend + frontend unit suites; `npx playwright test` runs E2E headless via docker compose |
| 03 | Per-user profiles & household auth | Multiple named profiles; each has isolated progress/history; single shared household password gates the app |
| 04 | Server-side progress & full listening history | Position, completed, sessions, speed, timestamps persist per profile per book and survive device switches |
| 05 | Playback experience core | Resume, speed control, sleep timer, chapter seek all work in desktop and mobile browsers |
| 06 | Chapter support | M4B chapters and multi-file track lists render and seek correctly; chapter editing possible later |
| 07 | Metadata enrichment | Every book can be matched to Open Library/Google Books, confirmed or corrected manually, covers/descriptions filled |
| 08 | PWA packaging | App installable on Android home screen, offline shell, lock-screen/background playback behaves |
| 09 | Android wrapper | Capacitor or TWA wrapper builds an installable APK pointing at the server |
| 10 | LAN deployment | Server runs on home hardware (PC → Pi), reachable from all LAN devices, survives reboot, documented setup |
| 11 | Security hardening & testing | Filesystem access confined to library roots; security test suite (traversal, bad input, range abuse) in CI-style run |
| 12 | AI features (LM Studio, optional) | At least one guarded AI feature ships (metadata matching assistant or description summaries); app fully works with it off |
| 13 | Media tools (stretch) | Manual, explicit metadata/cover embedding into files with confirmation; no silent writes |
| 14 | Listening position display | Player shows chapter + position in chapter + book % and time left, with chapter ticks and a session-start marker; grid shows a Continue listening section. Position maths lives in a tested pure module |
| 15 | GUI redesign | **Done.** All twenty client surfaces restyled as one mobile-first system — capsule world, light/dark toggle, self-hosted faces. Player, grid and library shell done; reuses spec 14's `position.ts` and `ProgressTimeline` rather than rebuilding them. See [`specs/15-gui-redesign.md`](specs/15-gui-redesign.md) and [`DESIGN.md`](DESIGN.md). Renaming the wordmark to Bookle is still to schedule |
| 15b | Post-testing polish | **All five features shipped.** Seven findings from real household use on two phones — cover caching, per-profile privacy, Discover pagination, refresh empty window, player-first book page, lock-screen latency, copy review. Five of the seven ship here, in the order `4 → 5 → 1 → 3 → 7`; profile privacy (2) and lock-screen latency (6) are deliberately out. **Shipped:** refresh never blanks the library (`235aa28`), the player leads the book page (`35316d5`), covers are cached on the device and rendered in three states (`4a7df3c`, `fb19435`), Discover returns five ranked suggestions at a time (`cb28038`), and every user-facing string lives in `client/src/copy.ts` in one voice. The copy review turned up the rule worth carrying forward: *a heading, an explanation or a hint must say why the listener is there and what they can do, in their terms — not what the system is doing.* See [`specs/15b-post-testing-polish.md`](specs/15b-post-testing-polish.md) and [`user-testing-2026-10-18.md`](user-testing-2026-10-18.md). Supersedes the ordering in `LIMITATIONS` §6 |
| 16 | Provider expansion & background enrichment | Audnexus + LibriVox clients joined in an adaptive chain; a resumable post-scan pass auto-applies high-confidence matches and queues the rest; no media writes |
| 17 | Tag & taxonomy model | Curated genre tree, multiple narrators, series + position, publication facts, and per-field user overrides that survive rescans without freezing unrelated fields |
| 18 | Favourites & custom tags | Per-profile favourites; household-managed tag vocabulary with create/rename/merge/delete; assignments survive rescan |
| 19 | Recommendations & wishlist | Discover returns only books the household does not own, seeded by one book or the profile's favourites; per-profile wishlist with an "owned" marker |
| 20 | Browse & Discover UI | Genre shelves, filter bar with URL state, category pages, series shelves, Discover tab, full tag-suite detail, tag manager, enrichment review queue |
| 21 | Official chapter titles | Embedded chapter names ("Section 01", "01 - TITLE") replaced by real provider chapter names, matched by filename identity; a hand-set title is never overwritten and survives rescans |
| 22 | Search | Typed search over the library: bare words match title/author/narrator/series/tag/genre/description, `author:`/`genre:`/`narrator:`/`series:`/`tag:` narrow to one field, results are shareable via the URL |
| 23 | Cover art fallback | A book whose winning provider has no cover (LibriVox carries no cover field) gets artwork from the best candidate that does, borrowing only the image |
| 24 | Narrator resolution | Narrator resolved from `composer`, then a "Read By X" comment tag, then a bracketed folder name; full casts become one contributor per person; no guess when nothing matches |
| 25 | Catalogue enrichment | Genres, series, publisher, year, ISBN and description populated from Open Library and Google Books; study-guide spam rejected; auto-apply banded so a lowered floor cannot apply the wrong author |
| 26 | Android app with offline listening | Sideloaded APK plays downloaded books with no network; metadata readable offline; progress syncs without ever silently regressing; "remove from device" frees space; server URL configurable in-app. Narrows item 09. **In progress:** auth, download, covers, first-run server-URL setup and offline playback are verified; **the visible list of downloaded books and "Remove from device" remain** — the user removed it from the 15b polish pass on 2026-10-19, and it is recorded as an unmet criterion in `LIMITATIONS` |
| 27 | Per-profile library membership | Each profile has its own shelf of books, chosen from the server's library. **New profiles start empty; existing profiles are migrated to contain every book**, so nobody's library changes on upgrade — and it is one line to flip. `Profile.followsServerLibrary` says what happens to a book scanned *tomorrow*: the profiles that existed when the feature shipped follow the server library, a profile created afterwards does not. A separate "All books" tab is where books are added from; removing a book offers to delete its download too. Membership is a row, not a file — two profiles can hold the same book, the audio stays put. The 512 MB cover cache is untouched by it. **Offline the tab falls back to the books on this device** — which is what the app's library already is while the server is unreachable — so it can still remove one, and it never claims the household has no books. **Built 2026-10-21**; spec: [`specs/27-per-profile-library.md`](specs/27-per-profile-library.md) |

## Notes

- Items 01–06 form the playable, syncable core.
- Items 07–09 complete the household product.
- Items 10–11 make it trustworthy to leave running.
- Items 12–14 are enhancements; do not start until 01–05 are solid.
- Item 15 follows 14 deliberately: 14 builds the data and layout layer that the
  redesign then restyles, so the redesign is not a rewrite of the maths. It
  landed last, as planned, and went wider than its finish line — all twenty
  surfaces rather than the player, grid and shell — because a partial restyle
  would have left the app looking like two products.
- Item 15's spec was written after the code, which breaks the order in
  `AGENTS.md`. `specs/15-gui-redesign.md` records that at the top rather than
  pretending otherwise.
- Remote/internet access is intentionally absent; see `decisions/006-remote-access.md`.

## Build order after 14

**16 → 17 → 18 → 19 → 20 → 21 → 22 → 23 → 24 → 25 → 26 → 15.**

**15b runs alongside the above, and 27 follows it.** 15b is a polish pass on the
shipped app rather than new capability, so it interleaves rather than blocking.
27 (per-profile library membership) came after 15b closed, because it changes
what `GET /api/audiobooks` returns — and 15b's last feature, the copy review,
is what stops the new tab introducing a second voice. The two ended up
shipping together for exactly that reason: the "All books" tab was written
against the reviewed copy table, so it says "Select books to add to your
library" rather than describing the server.

Each of 16–19 is a data-layer feature with no new UI, so they are
independently shippable and testable. 20 adds the browse and Discover surfaces
on top. 21 fills in real chapter names underneath the player that 20 put on
screen, 22 adds the typed search over the metadata 17/21 populate, 23 lets
cover art come from a different provider than the one that matched the title,
24 makes the narrator resolvable for commercial audiobooks, and 25 makes the
catalogue fields (genres, series, publisher, year, description) actually
populate.

**26 comes next, and displaces 15.** Scope changed in response to user
feedback: the household must be able to listen away from home, on Android, and
the current app cannot work without the server at all. That is a larger gap than
the GUI looks. See `specs/26-android-app.md` and
`decisions/012-device-is-a-player-not-a-library-manager.md`.

**Item 15 (GUI redesign) moves to last, after 26** — this reverses the original
ordering twice over. Restyling a shell that is about to be wrapped in an APK and
run offline would mean restyling it again. Writing `specs/15-*.md` is the first
task of that work.

**Item 13 (media tools) remains out of scope.** Media is a read-only mount by
design; writing tags into user files is not wanted. The tagging and
presentation work lives in 16–20 instead.

**Item 26 preserves ADR 006** (`decisions/006-remote-access.md`). Books are
downloaded over the LAN and progress syncs on returning home, so no remote
access to the home server is required.

**Item 15b is the current session's work** and takes precedence over the
ordering above. It is a polish pass on the shipped app rather than new
capability, so it runs alongside 16–26 instead of before them. Its five
features each land as their own commit against the acceptance criteria in
[`specs/15b-post-testing-polish.md`](specs/15b-post-testing-polish.md).
