# Showcase talk - Audiobook Manager (5 minutes + Q&A)

**Status:** v2 after first human edit pass. Deck restructured 2026-11-17: reflection
slide removed, Nov 1-17 fleshed out over two slides, edit-mode save artifacts cleaned
(`body.editing`, spellcheck noise), deck and notes normalized to UTF-8.
**Format:** `docs/presentations/showcase/index.html` - self-contained, styled as the
app's light room: Fredoka (display) + Nunito (text), self-hosted from
`assets/fonts/`, the light aero atmosphere, capsule panels with marker strokes and
the radius wobble, chips as selectable glass, the play dome as the one glossy accent.
Values lifted from `client/src/index.css` (light theme) and `DESIGN.md`.
**Human-editable by design:** all slide text is plain markup you can rewrite directly,
plus an embedded edit mode (see below) for click-to-edit and tagged rectangles.
**Voice:** match your edit pass - plain hyphens, no em dashes, grounded in dates,
commits and real events, no corporate slogans. Short declarative headlines.
**Length:** ~14 slides · Alley discipline (sentence headlines, one image per slide,
≈1 min/slide where a slide carries content).

## Spine (approved)

Opening (why I built it → what it is) → condensed build timeline (UI + architecture) →
live demo on the production site (with a produced video fallback) → challenges faced →
questions. The story is the app's growth; the agents are the method, stated plainly
in the challenges.

## Time budget (approved)

Title 10s → Why 40s → timeline (6 beats, ~20-25s each, ~130s) → Bridge 5s →
demo 60s → challenges 75s → Try-it 5s ≈ 5:00. The timeline narration is the flex
point; the demo is not negotiable.

## Slide inventory (current)

| # | Slide | Image | Spend |
|---|-------|-------|-------|
| 1 | Title - **Audiobook Manager**; your name, course, date | current light-mode library hero (`assets/hero-library-desktop.png`) | 10s |
| 2 | "Audiobooks are a mess - four or more apps and a folder of MP3s" - the why | hero image | 40s |
| 3 | T1 · Sep 22-23 - Prototyping: how a mock up becomes a real library | `era0-desktop.png` → `eraSep23-desktop.png` | ~25s |
| 4 | T2 · Oct 2 - The first full system | `era2-first-system-light.svg` (bigger, per edit pass) | ~25s |
| 5 | T3 · Oct 12-21 - Building the app (Android, then the restyle, then offline) | `era3-android-light.svg` | ~25s |
| 6 | T4 · Oct 22-Nov 5 - Preparing for the future (Postgres, GDPR, admin door) | `era5-postgres-light.svg` | ~25s |
| 7 | T5 · Nov 6-12 - The architecture review (RLS, device identity, spec 37, kids, OAuth, media proxy) | `era7-rls-light.svg` | ~25s |
| 8 | T6 · Nov 13-17 - The final week (aero merge, spec 41, spec 42 + security remediation, spec 45, submission) | `review-flow-light.svg` | ~25s |
| 9 | Bridge - "Enough history." | - | 5s |
| 10 | Live demo - sign in (your personal account) → shelf → a book → play → settings glimpse (build, connected devices) | flow checklist; fallback video | 60s |
| 11 | Challenge 1 - free tools, finite tokens, ensuring consistency across agents and sessions; handoff.md origin, commits as the handoff, what CI caught that local missed | numbers panel | ~25s |
| 12 | Challenge 2 - hallucinations: every story in symptom / cause / fix form (double-encoded bodies; unreachable `onEnded`; Christmas Carol / misc Discover regression co-authored with agents, fixed after you noticed) | `now-discover-desktop.png` | ~25s |
| 13 | Challenge 3 - the Android offline split: a replica, not a second server | `now-detail-phone.png` | ~25s |
| 14 | Try it - production URL + QR + repo link; stays up for Q&A | QR (`assets/qr-demo.png`) | 5s + Q&A |

## Numbers allowed (process-first, verified)

467 commits · 56 days · 45 specs · 39 ADRs · 975 server + 1008 client tests (1,983) ·
3 deployments (LAN household, Android APK, hosted demo) · 3 fresh-context reviews ·
submission build `5d67e0f` (Nov 17). Nothing about the code will be stated without
your wording.

## Environment

- Live demo on production: `https://audiobook-manager.onrender.com` - you sign in with your
  personal account (everyone on the course has it).
- Fallback (mandatory): a fully produced recording of the same flow - agent-captured via the
  `web-video-presentation` skill (`npx get-skill add conardli/web-video-presentation`),
  ~60-90s, warm conversational UK voiceover; you review and approve it before the talk.
- QR code on the final slide points at the production URL (`assets/qr-demo.png`).

## Speaker notes

`docs/presentations/showcase/notes.html` - one cue card per slide: the sentence to open
with, the beats, the numbers to repeat, and the "if it goes wrong" note. Read it beforehand;
the talk is allowed to be loose.

## Voice (locked in from your first edit pass)

- Plain hyphens (`-`), never em dashes or en dashes.
- Short declarative headlines, usually a noun phrase ("The first full system.", "Building the app").
- Dates, commit SHAs and real events carry the story. No abstraction, no slogans,
  no corporate pitch language.
- Grounded in what actually happened, including the failures.

## Embedded edit mode

- Normal view has zero edit chrome. `E` or `?edit=1` enters edit mode; `Esc` leaves it.
- **Text:** headlines/paragraphs/bullets/chips/captions/cells are `contenteditable` in edit mode.
- **Save** (your button): serializes the slide DOM back into `index.html` with edit
  chrome stripped (no edit UI, no `editing` class, no `spellcheck`/`contenteditable`
  attributes, navdots cleared). Falls back to downloading a fresh `index.html` if the
  File System Access API is unavailable.
- **Rectangles:** drag on a slide → popover: instruction + tag (colour / image / layout / copy / other).
  Records slide id, rect as %, and every element the rect touches (tag, computed styles, bounding box).
- **edits.json** accumulates tagged instructions. On "implement the edits", the agent
  reads it, applies the changes, archives it to `edits-done-<date>.json`.

## Build order

1. Plan ✓ (this file)
2. Deck v2 ✓ - draft → human edit pass → encoding normalized → style pass → your review
3. Your run-through; timing check vs the 5:00 budget; flex timeline narration if over
4. Fallback demo video + voiceover (after your sign-off on the deck)

## Open risks (stated plainly)

- 5 minutes is tight: 6 timeline beats + demo + 3 challenges + Q&A. Beat narration is
  the flex; the demo is not.
- Live demo depends on the room's network and the production site; that is why the
  video fallback is mandatory. Confirm the demo URL and your login work from the
  presentation machine before the day.
- The repo link on the Try-it slide is a guess (`github.com/BLedge99/audiobook-manager`);
  swap or drop it if the repo isn't public.
- `web-video-presentation` skill is not yet installed; the video is built after the deck is approved.
