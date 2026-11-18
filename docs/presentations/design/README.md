# Timeline + capture harness

**`index.html`** is the GUI/UX timeline deck: 2026-09-22 → 2026-11-17, self-contained,
keyboard navigation, print-to-PDF styling.

Every image is under `assets/`. How each was made:

- **Harness captures** (`era0-*`, `eraSep23-*`, `oct17-*`, `now-*`): the real historical
  (or current) `client/` source rendered by `./harness`, a minimal Vite shell that mocks
  `fetch` with canned LibriVox-style data — no server needed, disk impact ~zero.
  To re-capture an era:
  1. `git archive -o /tmp/era.tar <sha> client` (or copy `client/` for HEAD)
  2. extract into the harness working directory, with this folder's `index.html`,
     `harness/*` and a copy of the era's `public/placeholder-cover.svg` beside them
  3. `npx vite build --outDir dist` then serve `dist/` statically on a free port
  4. screenshot with the repo's Playwright

  The harness mocks the **current** API shape; for historical eras it was adapted
  to that era's fetch contract (see git history of this directory). Fonts load as
  font/woff2; the production build target is es2022.

- **design-lab captures** (`gen0-*`, `gen1-v*-*`): the real app on 2026-11-14, captured
  by `docs/design-lab/capture-ui.js` against the live stack. v2 was the dark-only
  variant — it is shown in dark; the others are shown in light. Every variant's
  capture was checked against its manifest before use.

- **Device photos** (`offline-*-pixel4a|defy-2026-*.png`): taken on the household's
  phones during the offline-era testing; stored under `specs/evidence/`.

Coverage notes:

- No capture exists for Oct 2–13 (gate era) — that screen is reproduced in the deck
  from `LoginGate.tsx` @ `99f6dbb` and labelled as such.
- No capture exists of the design-lab experiment in progress; the lab's ledger
  (`docs/design-lab/ledger.json`) is quoted where the deck states what did and did not happen.
