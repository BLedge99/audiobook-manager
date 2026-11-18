# Video Outline

> **Theme**: TBD at Checkpoint Plan (top pick: `warm-keynote`, or a custom `app-light` theme from the app's tokens — Fredoka + Nunito, cream ground, raspberry accent)
> **Total length**: ~80s (voiceover ~200 words at natural pace)
> **Chapters**: 5 / 13 steps

---

## 1. coldopen - the parents problem (2 steps · ~8s)

**Info pool** (chapter agent pulls as needed for captions / side notes):
- Quote: "Nobody could say where any book lived" — from the script (showcase slide 2, showcase/index.html)
- Comparison: many platforms/apps vs one place — from showcase slide 2 (piece 4/platforms + library loans + VLC rips)
- Caption: "Audible · Google Play Books · Libri.fm · VLC" — showcase slide 2

**Development plan**:
- step 1 (~4s) — Full-screen line: four app icons scattered over a dark floor, "Nobody could say where any book lived."
- step 2 (~4s) — "So I built one." fills the frame, raspberry accent

Voiceover excerpt:
> "My parents were drowning in audio apps… So I built one."

---

## 2. the-fix - point it at the folders (3 steps · ~16s)

**Info pool**:
- Quote: "Audiobook Manager is an app for a household." — article.md §What it is
- Process: folders in → scanned files → covers/descriptions/series/progress out — article.md §What it is
- API facts: Open Library + LibriVox (no key), Google Books (optional key) — article.md §Which API it uses
- Fact: runs on an always-on home machine — article.md §The idea, and §Who it is for

**Development plan**:
- step 1 (~5s) — "Point Audiobook Manager at the folders your books live in." A directory listing assembles itself on screen (N-level tree)
- step 2 (~7s) — Scan sweep: tags read → covers fetched (Open Library / Google Books / LibriVox) → series grouped → resume positions appear
- step 3 (~4s) — "It does the rest." The library grid resolves

Voiceover excerpt:
> "…it does the rest: reads the files, fetches covers and descriptions…"

---

## 3. inside - a shelf for everyone (4 steps · ~32s)

**Info pool**:
- Fact: each profile keeps its own place, favourites, history — article.md §Main features (One profile each)
- Fact: adult sets age band per child; too-grown-up books don't show — article.md §Main features (Kids, gently)
- Fact: on Android, books are taken with the phone; progress catches up on reconnect — article.md §Main features (Works away from home)
- Feature notes: chapters, speed, sleep timer; grid of covers; continue listening; shelves by genre and series; typed search — article.md §Main features (Browse / Press play)
- Source figure: detail dialog with player + chapters; phone mock screens — showcase/assets/now-detail-phone.png

**Development plan**:
- step 1 (~7s) — Grid of covers; the "continue listening" row surfaces first, one card foreground ("Picks up where you left off" as on-screen caption) (mock copy)
- step 2 (~7s) — Play / chapters / sleep timer inset — the detail dialog; chapter list + timer glyph (mock UI)
- step 3 (~6s) — Adult profile vs kids profile side by side; books with age 14+ do not appear for the child; band badge on the kid's profile (mock copy)
- step 4 (~12s) — Phone outline, offline mode on: a book card downloads checkmark; progress bar fills offline; on reconnect a sync sweep pushes the position back

Voiceover excerpt:
> "Everyone in the house gets their own profile… the kids get an age band…"

---

## 4. the-fine-print - the boring details (2 steps · ~12s)

**Info pool**:
- Fact: files stay read-only — article.md §What it is ("The files themselves are treated as read-only")
- Fact: no adverts, no subscriptions, nothing leaves your network unless you look covers up — article.md §The idea
- Fact: shipped Sept 22 → Nov 17 2026, 467 commits — git log
- Fact: GDPR-compliant export/erase; encrypted backups weekly — specs 41-45 (repo)

**Development plan**:
- step 1 (~6s) — "The files stay read-only." A folder property panel shows read-only ticks; a book file is untouched in the background
- step 2 (~6s) — "September → November. 467 commits." Counter ticks up to 467 next to a capsule-outline bookstack

Voiceover excerpt:
> "The files stay read-only… Shipped September to November, about 470 commits."

---

## 5. try-it - scan the QR (2 steps · ~14s)

**Info pool**:
- Fact: free web demo hosted at audiobook-manager.onrender.com — article.md §What it is (hosted free demo) + showcase/index.html slide 14
- CTA: scan the QR for the free web demo — script.md
- Constraint: web works in Safari (no iPhone app) — article.md §What it deliberately does not do
- Source figure: qr-demo.png — showcase/assets

**Development plan**:
- step 1 (~8s) — "Scan the QR." The QR fills the frame, phone outline behind it, audiobook-manager.onrender.com in plain Nunito on the side
- step 2 (~6s) — "Point it at a folder of LibriVox books and it stops looking like a demo." The shelf grid assembles behind the QR

Voiceover excerpt:
> "Want to see it? Scan the QR for the free web demo."

---

## Assets list

### 1. coldopen
- mock phone app icons (Audible / Google Play Books / Libri.fm / VLC) — build assets (CSS/SVG)
- hero-library-desktop.png for background depth (showcase/assets) ✓

### 2. the-fix
- SVG directory tree + scan sweep animation — build (CSS/SVG)
- eraSep23-desktop.png for reference (Sep 23 scaffold: hero + folders + grid) — showcase/assets ✓

### 3. inside
- now-detail-phone.png (detail dialog) — showcase/assets ✓
- hero-library-phone.png (phone mock) — showcase/assets ✓
- era3-android-light.svg (Android outline) — showcase/assets ✓
- Kids/profile side-by-side and offline downloads — CSS illustration required

### 4. the-fine-print
- assets/fonts/Fredoka + Nunito — showcase/assets/fonts ✓
- README commit counter — CSS counter + capsule line-art

### 5. try-it
- qr-demo.png — showcase/assets ✓
- hero-library-desktop.png for backdrop grid — showcase/assets ✓

---

**All compositions are build-generated; no licensing concern; real captures from the showcase are reused where they show the real app.**
