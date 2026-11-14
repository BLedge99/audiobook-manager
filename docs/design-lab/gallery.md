# Design lab — gallery

Experimental, evolutionary GUI overhaul for Bookle, inspired by Human Made's
[self-optimising WordPress](https://humanmade.com/word-on-the-future/self-optimising-wordpress/):
agent-generated variants scored by an (eventual) vision-model judge against a hidden rubric,
iterated on checkpointed branches. See `scripts/design-lab-capture.js` for the capture
harness and `ledger.json` beside this file for the machine-readable history.

**Honest status, 2026-11-14 (updated):** the tournament has *not* run yet — the cloud VL
free tier is exhausted, and judging in-session was substituted for calibration because
generating variants couldn't wait. Fitness judging is pending the 2026-11-15 quota reset;
the final call stays with you either way. Gen 1 fitness scores below are not recorded yet.

**Honesty notes (read once):**

- Fitness measures *judge-perceived quality against a hidden rubric*, not household
  behaviour. There is no conversion funnel in a family app. What the lab produces:
  increasingly bold, increasingly polished screens chosen ruthlessly. What it cannot
  produce: evidence these land with the household — that's your veto at merge time.
- The rubric lives outside this repo (`rubric.md`, not committed by design); variant
  implementers never see it — only judges do.
- Every generation is a git tag/branch. Rolling back is a checkout, not archaeology.
- Screenshots show the seeded fixture library (LibriVox, public domain) as seen by the
  throwaway `design-lab` capture profile. No household media appears in git history.
- The screens below were captured against the live stack *after* the WSL 9P file-watch fix
  (see `docs/design-lab/ledger.json`). Earlier v1/v2 captures that showed the frozen
  build were retaken; those retakes are what you see here.

## Quick start (no running app required)

- **Browser:** double-click [`gallery.html`](gallery.html) in this folder — every design, side by side, no server needed.
- **GitHub/IDE:** this file.
- **Git tags:** `design-lab/gen0/champion` marks the untouched baseline; each variant kept
  its branch `design-lab/gen1/vN`.

## Gen 0 — baseline (champion)

- Tag: `design-lab/gen0/champion` · commit `c22f573` · captured 2026-11-14
- Concept: post-spec-15b shipped client — injection-moulded capsule vending, drawn by hand
- Guards: layout, sideways-scroll, detail-dialog fit, leaked comments — **pass**

| Phone — library (light) | Browse (light) | Detail (light) |
|---|---|---|
| ![g0 lib light](gen-0/phone-library-light.png) | ![g0 browse light](gen-0/phone-browse-light.png) | ![g0 detail light](gen-0/phone-detail-light.png) |

| Phone — library (dark) | Browse (dark) | Desktop — light | Desktop — dark |
|---|---|---|---|
| ![g0 lib dark](gen-0/phone-library-dark.png) | ![g0 browse dark](gen-0/phone-browse-dark.png) | ![g0 desktop light](gen-0/desktop-library-light.png) | ![g0 desktop dark](gen-0/desktop-library-dark.png) |

## Gen 1 v1 — quiet hierarchy

- Branch: `design-lab/gen1/v1` · hill-climb seed, inside identity
- Concept: the volume knobs, not the voice — cover-forward cards (art fills more of the card),
  calmer filter strip as a subordinate control rail, one shared tabular-numerals contract
  for every figure (.nums), header stat line reworked. Card chrome tightened; no tokens changed.
- Guards: **pass** · 895 unit tests pass

| Library (light) | Library (dark) | Browse (light) | Detail (light) |
|---|---|---|---|
| ![v1 lib light](gen-1/v1/phone-library-light.png) | ![v1 lib dark](gen-1/v1/phone-library-dark.png) | ![v1 browse light](gen-1/v1/phone-browse-light.png) | ![v1 detail light](gen-1/v1/phone-detail-light.png) |

| Browse (dark) | Desktop (light) | Desktop (dark) |
|---|---|---|
| ![v1 browse dark](gen-1/v1/phone-browse-dark.png) | ![v1 desktop light](gen-1/v1/desktop-library-light.png) | ![v1 desktop dark](gen-1/v1/desktop-library-dark.png) |

## Gen 1 v2 — dark-mode luxury

- Branch: `design-lab/gen1/v2` · hill-climb seed, dark only
- Concept: the dark theme as a lamp-lit room, not a dimmed page — deeper ground, warmer
  plum sunk, surface lifted with umber warmth, inks and accent-inks all beat their
  old contrast ratios, covers get a warm rim-light and deeper drop shadow, dark CTAs gain
  a static rasp halo. Light theme untouched.
- Guards: **pass** · 895 unit tests pass · DESIGN.md dark hex table needs syncing if merged

| Library (light) | Library (dark) | Browse (light) | Detail (light) |
|---|---|---|---|
| ![v2 lib light](gen-1/v2/phone-library-light.png) | ![v2 lib dark](gen-1/v2/phone-library-dark.png) | ![v2 browse light](gen-1/v2/phone-browse-light.png) | ![v2 detail light](gen-1/v2/phone-detail-light.png) |

| Browse (dark) | Desktop (light) | Desktop (dark) |
|---|---|---|
| ![v2 browse dark](gen-1/v2/phone-browse-dark.png) | ![v2 desktop light](gen-1/v2/desktop-library-light.png) | ![v2 desktop dark](gen-1/v2/desktop-library-dark.png) |

## Gen 1 v3 — newsprint zine (eliminated by direction)

- Branch: `design-lab/gen1/v3` · **extinct — rejected 2026-11-14 without tournament**
- Concept: risograph print world — ivory paper, one spot colour (riso rasp), zero radius,
  hard offset registration shadows, 900-weight serif masthead, barcode status tags.
- Kept deliberately: extinction is part of the record. Not mergeable; do not revive without
  an explicit request.

| Library (light) | Library (dark) | Browse (light) | Detail (light) |
|---|---|---|---|
| ![v3 lib light](gen-1/v3/phone-library-light.png) | ![v3 lib dark](gen-1/v3/phone-library-dark.png) | ![v3 browse light](gen-1/v3/phone-browse-light.png) | ![v3 detail light](gen-1/v3/phone-detail-light.png) |

| Browse (dark) | Desktop (light) | Desktop (dark) |
|---|---|---|
| ![v3 browse dark](gen-1/v3/phone-browse-dark.png) | ![v3 desktop light](gen-1/v3/desktop-library-light.png) | ![v3 desktop dark](gen-1/v3/desktop-library-dark.png) |

## Gen 1 v4 — aero polish

- Branch: `design-lab/gen1/v4` · user-steered iteration, inside identity
- Concept: same machine, materially lit — a visible horizon wash (rose-coral to pearl),
  lamp pool top-right, cool lavender settling bottom-left; top-lit panels and specular
  glass bar/rail; capsule press rock, two-swing hover wobble, dome jelly, dispense shake
  before detail opens; deeper dark ground; **pass 3**: one off-white ink ramp (ink `#e8e4ee`),
  one glass recipe everywhere, select buttons translucent with theme-true hairline borders
  and an accent-family halo, disabled chips finally read as disabled.
- Guards: **pass** · 895 unit tests pass · pass 3 contrast table recomputed and documented in DESIGN.md

| Gate (light) | Library (light) | Library (dark) | Browse (light) | Detail (light) |
|---|---|---|---|---|
| ![v4 gate light](gen-1/v4/gate-phone-light.png) | ![v4 lib light](gen-1/v4/phone-library-light.png) | ![v4 lib dark](gen-1/v4/phone-library-dark.png) | ![v4 browse light](gen-1/v4/phone-browse-light.png) | ![v4 detail light](gen-1/v4/phone-detail-light.png) |

| Gate (dark) | Browse (dark) | Desktop (light) | Desktop (dark) |
|---|---|---|---|
| ![v4 gate dark](gen-1/v4/gate-phone-dark.png) | ![v4 browse dark](gen-1/v4/phone-browse-dark.png) | ![v4 desktop light](gen-1/v4/desktop-library-light.png) | ![v4 desktop dark](gen-1/v4/desktop-library-dark.png) |

## Candidates & their pages

- **Watch the motion (v4):** `page@0e6f5fff0fd3f056ccb104e362f8730c.webm` was recorded on
  demand and lives in `.impeccable/design-lab-clips/` (gitignored). If motion needs judging,
  re-record; stills were never going to tell you whether the wobble is delightful or silly.
- Fitness: **not yet recorded** — see `ledger.json`. Tournament pending your call + the
  VL quota reset (2026-11-15).
