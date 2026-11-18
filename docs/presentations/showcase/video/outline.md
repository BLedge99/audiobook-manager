# Video Outline

> **Theme**: TBD at Checkpoint Plan (top pick: `warm-keynote`, or a custom `app-light` theme from the app's tokens — Fredoka + Nunito, cream ground, raspberry accent)
> **Total length**: ~92s (voiceover ~233 words at natural pace, ~152 wpm)
> **Chapters**: 5 / 14 steps

---

## 1. coldopen - the mess (2 steps · ~10s)

**Info pool** (chapter agent pulls as needed for captions / side notes):
- Quote: "Audiobooks are a mess." — script.md §1
- Quote: "There's no way to unify your library." — script.md §1
- Comparison: many platforms/apps vs one place — from script.md §1 + showcase/index.html slide 2 (piece 4/platforms + library loans + VLC rips)
- Caption: "Audible · Google Play Books · Libri.fm · VLC" — showcase slide 2 / script.md §1 (none of them support raw audio files)

**Development plan**:
- step 1 (~5s) — Full-screen line: "Audiobooks are a mess." Four app icons (Audible / Google Play Books / Libri.fm / VLC) scattered over a dark floor; each one bounces off the same raw audio file
- step 2 (~5s) — "There's no way to unify your library." → cut to raspberry accent: "So I built one." fills the frame

Voiceover excerpt:
> "Audiobooks are a mess. Too many separate platforms, none of which support good old raw audio files. There's no way to unify your library."

---

## 2. the-fix - point it at your files (3 steps · ~21s)

**Info pool**:
- Quote: "Point Audiobook Manager at your audiobook files and it does the rest." — script.md §2
- Process: files in → read → covers/descriptions fetched (Open Library + Google Books) → series grouped → per-book positions tracked — script.md §2
- API facts (as voiced): Open Library + Google Books — script.md §2. For accuracy: LibriVox is also in the provider order — article.md §Which API it uses. Keep the on-screen caption to the two the script names
- Fact: it tracks playback position "for each and every book you listen to, so you can always pick up where you left off" — script.md §2
- Fact: runs on an always-on home machine — article.md §The idea, and §Who it is for

**Development plan**:
- step 1 (~6s) — "Point Audiobook Manager at your audiobook files." A directory tree assembles itself on screen (N-level tree)
- step 2 (~9s) — Scan sweep: files read → covers & descriptions fetched (Open Library / Google Books) → series grouped → a position marker lands on every in-progress book
- step 3 (~6s) — "It does the rest." The library grid resolves; caption "always pick up where you left off"

Voiceover excerpt:
> "So I built one. Point Audiobook Manager at your audiobook files and it does the rest: reads the files, fetches covers and descriptions…"

---

## 3. inside - covers, cards and one shelf per person (4 steps · ~38s)

**Info pool**:
- Fact: books are displayed as covers on shelves by genre and series, with a "Continue listening" row — script.md §3 + article.md §Main features (Browse your books)
- Fact / Press play: "a card opens showing the player, as well as the book's chapters, and information" — script.md §3 + article.md §Main features (Press play)
- Fact: progress is synced **via the remote server** — script.md §3. Stop on the phone, carry on on the laptop
- Fact: every household member gets their own profile; kids accounts set an age band, so inappropriate books don't show — script.md §3 + article.md §Main features (One profile each / Kids, gently)
- Fact: on Android, books can be downloaded offline — "listening position is saved locally and progress is synced when you're back" — script.md §3 + article.md §Main features (Works away from home)
- Feature notes: chapters, speed, sleep timer; typed search — article.md §Main features (Browse / Press play)
- Source figure: detail card dialog with player + chapters (phone mock) — showcase/assets/now-detail-phone.png

**Development plan**:
- step 1 (~9s) — Grid of covers on shelves sorted by genre/series; the "Continue listening" row surfaces first; on-screen caption "Books are displayed as covers, sorted on shelves by genre and series"
- step 2 (~10s) — "Press play" — the card opens: player, chapters, and book information; chapter list + sleep timer glyph (mock UI / now-detail-phone.png)
- step 3 (~7s) — Adult profile vs kids profile side by side; age band badge on the kid's profile; too-grown-up books absent from the kid's grid (mock copy)
- step 4 (~12s) — Cross-device: phone stops mid-chapter, laptop picks it up (position pushed via the remote server). Then Android outline, offline mode on: download checkmark appears on a card, the progress bar fills offline; on reconnect, a sync sweep pushes the position back

Voiceover excerpt:
> "Books are displayed as covers, sorted on shelves by genre and series… Everyone in the house gets their own profile; kids accounts set an age band…"

---

## 4. the-fine-print - the boring details (3 steps · ~17s)

**Info pool**:
- Fact: files stay read-only — script.md §4 + article.md §What it is ("The files themselves are treated as read-only") and §Privacy and your data
- Fact: works with the internet off — script.md §4 + article.md §Privacy and your data / §Main features (Better pictures)
- Fact: online cover lookups send book details only — never anything about your household — script.md §4 + article.md §Privacy and your data / §Which API it uses ("Queries carry book details only")
- Fact: GDPR retention policy — export and erase on request — script.md §4 + article.md §Privacy and your data (GDPR; specs 44/retention docs; GDPR-AUDIT.md)
- Fact: shipped Sept 22 → Nov 17 2026, ~470 commits — git log (467+)

**Development plan**:
- step 1 (~6s) — "The files stay read-only." A folder property panel shows read-only ticks; a book file is untouched in the background
- step 2 (~6s) — "It works with the internet off." Wi-Fi glyph off; covers still show from cache, a downloaded book plays; caption "online lookups send book details only"
- step 3 (~5s) — "Erase and export on request." GDPR shield/document glyph; then "September → November. About 470 commits." Counter ticks up beside a capsule-outline bookstack

Voiceover excerpt:
> "The files stay read-only. It works with the internet off… Data is protected under the GDPR retention policy — erase and export on request."

---

## 5. try-it - scan the QR (2 steps · ~6s)

**Info pool**:
- Fact: a free web demo of the app is hosted online; it is what the QR points to — script.md §5 + article.md §Which API it uses (hosted demo) + showcase/index.html slide 14 (audiobook-manager.onrender.com — on-screen URL, not voiced)
- CTA: "Want to see it? Scan the QR for the online web demo and start listening!" — script.md §5
- Constraint: web works in Safari (no iPhone app) — article.md §What it deliberately does not do
- Source figure: qr-demo.png — showcase/assets

**Development plan**:
- step 1 (~4s) — "Want to see it?" The QR fills the frame, phone outline behind it, audiobook-manager.onrender.com in plain Nunito on the side
- step 2 (~2s) — "Start listening." The QR cracks like a book opening; first cover of a LibriVox shelf rises behind it

Voiceover excerpt:
> "Want to see it? Scan the QR for the online web demo and start listening!"

---

## Assets list

### 1. coldopen
- mock phone app icons (Audible / Google Play Books / Libri.fm / VLC) — build assets (CSS/SVG)
- hero-library-desktop.png for background depth (showcase/assets) ✓

### 2. the-fix
- SVG directory tree + scan sweep animation — build (CSS/SVG)
- eraSep23-desktop.png for reference (Sep 23 scaffold: hero + folders + grid) — showcase/assets ✓

### 3. inside
- now-detail-phone.png (detail card: player + chapters + info) — showcase/assets ✓
- hero-library-phone.png (phone mock) — showcase/assets ✓
- era3-android-light.svg (Android outline) — showcase/assets ✓
- Kids/profile side-by-side, cross-device hand-off, offline downloads — CSS illustration required

### 4. the-fine-print
- assets/fonts/Fredoka + Nunito — showcase/assets/fonts ✓
- README commit counter — CSS counter + capsule line-art
- Wi-Fi-off and GDPR export/erase glyphs (shield / document) — build (CSS/SVG)

### 5. try-it
- qr-demo.png — showcase/assets ✓
- hero-library-desktop.png for backdrop grid — showcase/assets ✓

---

**All compositions are build-generated; no licensing concern; real captures from the showcase are reused where they show the real app.**
