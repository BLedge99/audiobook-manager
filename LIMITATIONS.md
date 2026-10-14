# Known limitations and planned work

A single place to record **what does not work yet**, **why**, and **what to do
about it**. Written 2026-10-13 against `master` @ `ff0e600`.

Every claim here was verified against the running stack or the live provider
APIs, not inferred from reading code. Where a number is given, it is measured.

Status legend: **BROKEN** = does not work · **LIMITED** = works, but narrower
than intended · **DEFERRED** = deliberately not built.

---

## 1. Broken

### 1.1 Google Books is completely non-functional
**Status: BROKEN — needs a key.**

`GET https://www.googleapis.com/books/v1/volumes` returns `{"error": ...}` from
this host. `searchGoogleBooks` then returns `[]` silently, so half the provider
chain has been doing nothing at all.

The mapping code is **written and unit-tested** — `mapGoogleVolume` extracts
`categories`, `publisher`, `publishedDate`, `industryIdentifiers`, `language`,
`description` and `imageLinks`. Only the credential is missing.

```bash
# server/.env
GOOGLE_BOOKS_API_KEY=<key from console.cloud.google.com>
```

**Why it matters:** Google Books is the richest source for publisher, ISBN and
categories, and it covers books Open Library has no edition of. Expect the
biggest single jump in coverage from this one line.

### 1.2 Audnexus book metadata is never applied
**Status: BROKEN — architecturally blocked.**

`AudnexusProvider.search()` and `bookByAsin()` exist and are unit-tested, but
`resolveProviderOrder()` excludes `audnexus`, so `runChain` never calls them.
The only live Audnexus call is `chaptersByAsin()` for chapter titles.

This was intentional in ADR 011: Audnexus has **no book-search endpoint**. It
only answers about an ASIN you already hold. See §2.1 for why that is a dead
end.

### 1.3 `npm run scan` is a broken script
**Status: BROKEN — trivial.**

`server/package.json` declares `"scan": "tsx src/scripts/scan.ts"`, but
`server/src/scripts/scan.ts` **does not exist**. Running it fails. Use
`make scan` instead, which drives the API correctly and waits for completion.

Either add the file or delete the script entry.

### 1.4 The Android app cannot work away from home
**Status: MOSTLY FIXED (2026-10-14). Downloads verified on device; offline
playback and first-run setup are not.**

Sprint 2 has landed. What now works, verified on a Pixel 4a:

- **Auth.** The WebView is cross-site relative to a plain-HTTP API, so Chrome
  drops the `SameSite=Lax` cookie. Login returns the session token in the body
  and the server also accepts it in `x-house-session`; the cookie path is kept
  for the browser/PWA. Requests the browser issues itself (`<audio src>`,
  `<img src>`) carry the token in the query string, because a media or image
  element cannot send a header.
- **Download.** `@capacitor/file-transfer` writes each track with real progress.
  A full 5-track book downloaded and every file matches the server's
  `Content-Length` **byte for byte**.
- **Cover art** and **layout** at phone widths (guarded by
  `e2e/phone-layout.spec.ts`).

Still broken:

- **Offline playback is unverified.** The files are correct on disk; nobody has
  yet pulled the network and confirmed audio plays from them.
- **First-run is a dead end.** `needsServerUrl()` has no call site, so
  `ProfileGate` blocks the only route to Settings and a new user cannot enter a
  server address. This is the most user-visible remaining bug.
- **Downloaded audio is invisible.** `Directory.Data` is app-private: no file
  manager can see, free or delete downloaded books. ADR 012 accepted this; for a
  household app it is probably the wrong trade.

**Sprint 1 is complete** and it de-risked the two things that could have changed
the architecture. On a Pixel 4a / Android 13:

- Audio **does** keep playing with the screen off, and seeking works — but only
  behind a real foreground service. The web `navigator.mediaSession` API on its
  own gave *no* media notification and *no* lock-screen controls, because there
  was no service behind it. That is why Capacitor is being used at all, and it
  is now settled: `@capgo/capacitor-media-session` with
  `foregroundService: "always"`.
- The `server.url` problem is already fixed — it was removed, so the app serves
  its own bundled assets instead of trying to load `localhost:3000` (which on a
  phone is the phone, not the home server, and loaded nothing).

What remains is Sprint 2: download to the device filesystem, `convertFileSrc`
seeking, Dexie for metadata, and an in-app server-URL setting.

**Known trap:** a truncated MP3 reports the *full* file's duration while holding
only part of the audio, so seeking past its real end stops playback permanently
and Play cannot recover. This looked like an app bug during the spike and was
not. Use complete files from `test/`.

### 1.5 Listening progress is last-write-wins and can silently regress
**Status: BROKEN — data loss.**

`PUT /api/audiobooks/:id/progress` accepts any position, so a stale or buggy
client can overwrite a bookmark that is hours further ahead — with no warning.
The concrete failure: a phone dies offline at 1h 30m, another device listens to
2h 14m, the phone reconnects and pushes its older position.

Fixed in `specs/26-android-app.md`: progress becomes **monotonic** — forward
pushes apply silently, a backward move beyond 5 minutes is blocked and surfaced
as a conflict for the user to resolve, and an explicit `allowRewind` flag exists
for the deliberate case. Because the rule is monotonic, clock skew stops being a
correctness problem.

---

## 2. Limited

### 2.1 There is no way to obtain an Audible ASIN
**Status: BLOCKED — verified, no free route.**

Audnexus is ASIN-keyed, and the fixture commercial library carries **no ASIN
anywhere** — not in filenames, not in tags, not in MP4 atoms, including a
real `inAudible`-encoded M4B.

Every route tested and rejected:

| Route | Result |
|---|---|
| Audnexus `/books?title=` | 404 — endpoint does not exist |
| Audnexus `/authors?name=` | returns only `asin` + `name`; no book list |
| Audnexus `/authors/{asin}` | returns `asin, description, genres, image, name, region` — still no books |
| Open Library editions | `isbn_10` / `isbn_13` only; **no ASIN** |
| Apple iTunes | returns `collectionId`, not an ASIN; no narrator field |
| Embedded atoms | absent from the fixture M4B |
| Audible's own search | requires a signed request with a fixed private key — fragile and against their terms, which is what Audnexus exists to avoid |

**Consequence:** Audnexus can never be reached for a library without ASINs.
Keep the provider ready (region fallback, failure observability) but do not
build an ASIN resolver.

### 2.2 Enrichment is not deterministic
**Status: LIMITED — inherent.**

Two consecutive forced `make enrich` runs over identical media gave
**applied 10 / review 1** and then **applied 8 / review 4**. Nothing is cached
between runs; which providers answer varies per run, and LibriVox/Open Library
race for some books.

Treat published coverage numbers as a **range**, not a state. Two books are
*consistently* in review, and both are correct:

- **Creepy Tales** — best match is *"Twelve Creepy Tales"*, a different book
- **Short Ghost and Horror Collection 034 / 052** — exact LibriVox title
  matches that intermittently lose the provider race

Adding `GOOGLE_BOOKS_API_KEY` should reduce this by giving the chain a third
independent opinion.

### 2.3 Narrator coverage is 8/12 and capped by what files carry
**Status: LIMITED.**

Narrators are resolved locally (spec 24) in order: `composer` atom → `comment`
field (`Read By X`) → bracketed folder name (`{Stephen Fry}`). There is **no
online fallback**, because none exists:

- Open Library / Google Books / Apple iTunes: no narrator field — they catalogue
  the *work*, not the *recording*
- Audnexus: has narrators, but ASIN-gated (§2.1)
- LibriVox: has real `readers`, but only for public-domain titles

The two unresolved commercial books carry no narrator in any tag or folder
name. **This is the correct outcome, not a gap to close.** The spec 17
tag-suite editor is the intended manual answer.

### 2.4 Series coverage is 6/12 and may be at its ceiling
**Status: LIMITED.**

Series is read from Open Library, gated: only when no provider supplied one,
and only with both a name and a usable position. Several commercial sets simply
have no series data upstream. This may not be improvable without Audnexus.

### 2.5 Language is often empty on purpose
**Status: LIMITED — deliberate.**

Open Library merges every edition of a work, so `language` arrives as the set
of languages the book was *ever* published in — Harry Potter returned
`["gre","urd","arm","vie"]`. Taking the first would file an English audiobook
under Greek, so a **strict winner** is required and a four-way tie yields
nothing. Empty is the honest answer there.

### 2.6 Descriptions are fetched lazily and only from Open Library
**Status: LIMITED.**

Search results carry no blurb, so a description needs a second request per book.
It fires only when neither the candidate nor the book already has one. Only
Open Library work records are consulted; a Google Books description is used
directly when present.

### 2.7 Cover art comes from book catalogues, not the audiobook edition
**Status: LIMITED.**

Covers resolve independently of the title winner (spec 23), which fixed the
LibriVox case. But the sources are cover *editions* from Open Library or Google
Books thumbnails — not the artwork of the specific audiobook you own. You may
get a different edition's jacket.

### 2.8 Auto-apply has a judgement call in it
**Status: LIMITED — deliberate, and reviewable.**

The floor was lowered from 0.9 to 0.7, but with a guard: in the 0.7–0.9 band
the **author must agree**, because `scoreMatch` is ~85% title-weighted and a
bare floor drop auto-applies books by the wrong author.

The exception is an **exact title match**, which is what recovers LibriVox
collections (provider records "Various" where the file tags a narrator). That
exception is a judgement call, not a requirement — it is in
`shouldAutoApply` and easy to revert.

An explicitly requested threshold via the API is still honoured literally.

### 2.9 Contributor sets are replaced wholesale
**Status: LIMITED — known risk.**

`reconcileContributors` **replaces** a book's contributor set. If one provider
supplies one narrator and another supplies five, last write wins and one set is
silently discarded. Not observed to bite in the fixture library, but it is a
correctness risk if Audnexus is ever wired in alongside a catalogue provider.

### 2.10 `MediaItem.asin` exists but is never written
**Status: DORMANT.**

The column is in the schema and nothing populates it. ASIN extraction is
filename-only, and only at enrichment time. Writing it at scan time would make
Audnexus reachable permanently rather than incidentally.

---

## 3. Deferred

| Item | Why |
|---|---|
| **Spec 13 — media tools** | Out of scope by decision. Media is a read-only mount; writing tags into user files is not wanted. |
| **Spec 15 — GUI redesign** | The only roadmap item with **no spec file at all**. Needs `specs/15-*.md` written first. Now sequenced **after** spec 26, since restyling a shell that is about to be wrapped in an APK would mean restyling it twice. |
| **Chapter/track title editor UI** | Spec 24 shipped the `PUT /tracks/:trackNumber/title` endpoint and the `FieldOverride` storage, but **no UI**. A hand-set narrator/track title is only reachable via API. |
| **Bookmarks & highlights** | Needs a new data model. Deliberately out of spec 14. |
| **PWA raster icons / Lighthouse** | Placeholder SVG icons only; a Lighthouse PWA audit has never been run. |
| **Search relevance ranking** | Results keep library order. Fuzzy matching, stemming and scoring are a separate feature. |
| **Server-side search** | The library is fetched whole and filtered client-side. A `LIKE` query would add a second source of truth. |
| **iOS** | Explicitly not a requirement; nobody in the household owns an Apple device, so it could not be tested. |
| **Offline editing / enrichment / scanning** | Deliberately server-only. The device holds a read replica; see ADR 012. |
| **Download queues / whole-library sync** | Deliberately out of scope for spec 26 — one book at a time over the LAN. |
| **Play Store publishing** | Sideloaded APK is acceptable for a household. |

---

## 4. Security debt

`npm audit` in `server/` reports **12 advisories (2 critical, 6 high, 4
moderate)**. Client is clean (0).

| Package | Severity | Issue |
|---|---|---|
| `tinypool` | **critical** | Prototype pollution gadget in worker options → RCE |
| `vitest` | **critical** | via `@vitest/mocker` |
| `@fastify/static` | high | Authorization bypass via non-canonical URL paths |
| `fastify` | high | DoS via unbounded memory allocation in `sendWebStream` |
| `find-my-way` | high | DDoS with HTTP2 |
| `music-metadata` | high | Infinite loop in ASF parser |
| `vite` | high | Path traversal in optimized deps `.map` handling |
| `source-map-js` | high | Event-loop DoS via indexed source-map offsets |
| `@vitest/mocker` | moderate | Path traversal / arbitrary file read |
| `esbuild` | moderate | Dev-server cross-origin requests |
| `vite-node` | moderate | — |
| `file-type` | moderate | Infinite loop in ASF parser |

**Assessment:** most are dev-time (`vitest`, `vite`, `esbuild`, `tinypool`) and
do not ship in the production image. The two that matter are
**`@fastify/static`** (auth bypass — it serves the built client in
`Dockerfile.prod`) and **`music-metadata`** (infinite loop on a malformed ASF
file, reachable from the scanner on untrusted media).

All fixes are breaking major bumps, so they need their own change with a
re-run of the security E2E suite. **Not started.**

---

## 5. Developer-experience friction

- **E2E requires WSL + Docker.** `scripts/e2e-wsl.sh` provisions a Linux Node
  because WSL ships none and the Windows interop `npm` installs `.cmd` wrappers
  bash cannot execute. Docker is unavailable from the Windows shell.
- **WSL idles out and reaps the containers.** Any sequence of
  "start stack → query → inspect" must run in a **single** WSL session or it
  fails with connection errors that look like code bugs.
- **The Vite dev server in Docker misses edits made over the `/mnt/c` bind
  mount.** `docker compose restart client` before concluding a client change
  "does nothing".
- **E2E helper gotchas.** `ensureAuthed` does a *relative* `fetch` and fails
  with "Failed to parse URL" unless a `goto` has already run. `pickAnyProfile`
  waits for the "All audiobooks" heading, which only exists on the Library tab,
  so entering on `?tab=browse` times out inside the helper.
- **PowerShell mangles nested quotes** in `wsl -e bash -lc "..."`. Write a
  script file and invoke it instead.
- **`handoff.md` contains two stale mentions** of "owner pushes manually" inside
  dated 2026-10-02 session entries. They are an accurate record of those
  sessions and are intentionally left.
- **Android SDK installers stall on Windows.** `winget` sat at 0 bytes and the
  Android Studio installer froze on a GUI prompt. Plain `curl` of the
  commandline-tools zip worked at ~10 MB/s. Do not reach for an installer GUI.
- **Capacitor 7/8 needs JDK 21.** An older JDK fails `assembleDebug` with an
  unhelpful Gradle error. `JAVA_HOME=C:\Tools\jdk21` in the build script.
- **PowerShell `>` corrupts binary output**, so `adb exec-out screencap` produces
  an unreadable file. Use `cmd /c adb ... > file` for raw bytes.
- **`adb exec-out screencap` returns black while the display is dozing**, so the
  lock screen itself cannot be verified by screenshot. Ask the user, or assert on
  `dumpsys` instead.
- **Never rebuild or reinstall while the user is mid-test.** It looks exactly
  like playback spontaneously dying. Say what you are about to push.
- **A CDP timeout means the phone dozed, not that the code failed.** The WebView
  suspends with the screen, `adb forward` to the devtools socket then hangs, and
  the result looks identical to a hang in the app. Check
  `dumpsys power | grep mWakefulness` before concluding anything. This caused
  two false diagnoses.
- **Verify what is *installed*, not what is on disk.** `npm run build:android`
  runs `tsc -b && vite build`, so a type error means the bundle is silently
  **not** rebuilt and `cap sync` copies the previous one. Always confirm the
  asset hash or `dumpsys package | grep lastUpdateTime` changed.
- **Vite serves a stale transform on this bind mount.** After editing a module
  the dev server can keep serving the previous version, so a correct fix looks
  like a no-op and tests fail at an identical number. Clear it with
  `docker compose exec client rm -rf node_modules/.vite` and restart.
- **A probe must exercise the same code path as the failing feature.** Calling
  `window.Capacitor.Plugins.FileTransfer` directly proved downloads worked while
  the app's own button did nothing, because the app loaded the plugin through a
  different, broken path. That mismatch cost more time than any other mistake
  here.
- **Gradle cannot delete `build/` or `app/build/` while its daemon holds it.**
  `gradlew --stop`, then remove the directory, then assemble. This is the
  equivalent of `clean` and is what the "never skip clean" rule was protecting.

---

## 6. Suggested order of work

Scope changed on 2026-10-13: the household must be able to listen away from
home, so **the Android app is now the top priority** and displaces the GUI
redesign (roadmap item 15).

1. ~~**Spec 26 Phase 1 — de-risk spike.**~~ **Done 2026-10-13.** Background
   audio survives screen-off and seeking works, but only behind a foreground
   service — see §1.4 and `specs/26-android-app.md`. The architecture in ADR
   012 stands, so the spike did its job.
2. **Spec 26 Phase 2 — download to the device.** Audio to the native filesystem
   (not IndexedDB: `<audio>` cannot seek a blob in IDB), metadata to Dexie.
   Now the highest-value remaining work, since §1.4 is the largest product gap.
3. **Add `GOOGLE_BOOKS_API_KEY`** — one line, largest enrichment gain (§1.1).
4. **Spec 26 Phase 0** — the `LibraryStore` read-model seam. Server-only, no
   user-visible payoff, so it is reviewed on its own.
5. **Fix or delete the `scan` script** — two minutes (§1.3).
6. **Spec 26 Phases 3–4** — progress sync, storage management.
7. **Dependency upgrades with a security E2E re-run** — §4.
8. **Track title / narrator editor UI** — makes the spec 24 endpoint reachable
   by a human (§3).
9. **Write ASIN at scan time** — makes Audnexus reachable if such files ever
   appear (§2.10).
10. **Contributor merge rules** — needed before Audnexus is ever wired in (§2.9).
11. **`specs/15-gui-redesign.md`** — last.