# DESIGN.md

The client design system, as built. Written from the shipped world on 2026-10-18,
after [`specs/15-gui-redesign.md`](specs/15-gui-redesign.md) landed. The
contract this implements is that spec; this file is the reference for changing it.

Product truth lives in [`PRODUCT.md`](PRODUCT.md). The visual world is
**injection-moulded capsule vending, drawn by hand**.

## The idea in one line

A vending machine for stories: every book is a canted translucent capsule that
you spin, hold and tap open.

## Foundations

### Colour

Two raw palettes, one semantic remap. `index.css` declares each colour exactly
once; everything else references the semantic name, so a colour is changed in one
place and both themes move together.

| Role | Light | Dark | Used for |
|---|---|---|---|
| `--ground` | `#f6f2f6` | `#100e15` | page background |
| `--surface` | `#ffffff` | `#1e1b26` | panels, cards, sheets |
| `--sunk` | `#eae7ef` | `#0c0a10` | recessed panels, inactive rows |
| `--ink` | `#1b1720` | `#cdd0da` | headings, primary text |
| `--ink-2` | `#514b5c` | `#a9a4b8` | body text |
| `--ink-3` | `#6b6577` | `#827d92` | metadata, counts |
| `--line` | `#dbd7e2` | `#322d40` | rules, borders |
| `--rasp` | `#ff3d71` | `#ff5c87` | **the accent** — play dome, active tab |
| `--tan` | `#ff7a18` | `#ff9445` | in progress |
| `--mint` | `#0f9e83` | `#2fd9b6` | finished |
| `--cobalt` | `#3345d8` | `#8ba0ff` | not started |

Note on the dark ramp: it is deliberately mid-tone lavender-grey, not near-white — the previous off-white ramp still read as glare on the phone. `--ink-3` clears AA only on the opaque atmosphere (4.65:1 vs atmo-hi, 4.93:1 vs atmo-lo); on surface it lands at 4.27:1 and on panel-hi at 3.81:1, so ink-3 is metadata-on-atmosphere only. `--ink-2` clears AA on every opaque dark surface (7.93 ground / 7.01 surface / 6.25 panel-hi) and on flat bar/rail glass (4.54 / 4.89), but not under the bar/rail sheen strip (3.33 / 3.59) — the bar's small line of text is `--ink`, which holds 5.23:1 (bar, with strip) and 5.63:1 (rail, with strip). Full table in `.bar`'s comment in `index.css`.

Each accent has an `-ink` variant (`--rasp-ink` and friends) that is the only
version allowed to carry text. The saturated accents fail 4.5:1 on the light
ground, which is why the split exists rather than one colour doing both jobs.

**Status colour never travels alone.** Every use of a status colour is paired
with its written label — the `StatusTag` component, and the legend row under the
library heading. `scripts/capture-ui.js` does not enforce this, so it is a code
review responsibility.

### Type

- **Fredoka** (600) for display: headings, the wordmark, card titles, figures.
  Rounded geometric, and it carries the toy's voice without being a novelty
  face.
- **Nunito** (400/600/700) for text.
- Both **self-hosted** from `client/public/fonts`, latin subsets, ~69KB total.
  A PWA that has to work on a plane cannot depend on a CDN fetch.

The sketch character lives in stroke and cant, never in a handwriting face.
Nothing a listener must read in order to use the app is set in a decorative
typeface.

### Space and shape

A 4px module (`--u`). Radii are deliberately **uneven** — `--r-shell:
26px 20px 26px 20px / 20px 26px 20px 26px`. A hand-drawn rectangle is not a
rounded rectangle, and the mismatched corners do the work a filter would.

### Motion

| Token | Value | Used for |
|---|---|---|
| `--ease` | `cubic-bezier(.16,1,.3,1)` | the default |
| `--ease-pop` | `cubic-bezier(.22,1,.36,1)` | press and settle |
| `--t-fast` | 140ms | hover, press |
| `--t-base` | 240ms | capsule lift |
| `--t-slow` | 420ms | progress fill |
| `--t-dispense` | 720ms | the one authored moment |

Exponential ease-out from an already-visible default. No elastic or bounce
easing: the capsule's cant and its 3px press travel already give it weight, and
a bouncy curve fights that by wobbling past its own target.

`prefers-reduced-motion: reduce` collapses every duration to 1ms and removes the
particle burst and the ambient field entirely.

## Components

### The capsule

The signature element. A canted 3° rounded shell, `border: 2px solid var(--ink)`,
a real soft shadow, and a pressed state that travels into its own shadow. On
hover it straightens to 0° and lifts 3px.

`.capsule` (cards) and `.capsule--alt` (alternating cant, so a grid does not
read as a picket fence).

### Cover through acrylic

`ShellCover` never simply displays an image. The art sits inside a tinted shell
(`mix-blend-mode: multiply` in light, `screen` in dark), the plastic gloss sits
over the tint, and a crown seam plus two screw dimples mark it as moulded. The
tint is picked deterministically from the book id, so a given book always looks
the same.

### The play dome

`Dome` is the only glossy, spherical, fully saturated element in the app. Radial
shading for the material, a real 3px press offset, and an eight-particle burst on
press that animates `transform` and `opacity` only.

### Progress

`Tube` — a bordered capsule with a rounded fill. Mint when finished, tangerine in
progress, cobalt untouched. Always paired with a `StatusTag` and figures in
tabular numerals.

### Glass

Used in five places, and only because each earns it: the top bar and
the tab rail (both genuinely sit over scrolling content), the detail-sheet
close button (`.iconbtn--glass`, chrome at button scale), the selectable
family — the profile-picker capsules and the filter/tag chips (a control you
press, not a pane of chrome) — and the primary CTA (`.btn--primary`, the app's
play-shaped material). Chrome sits at 86–93% opacity, never less: at
72% it looked correct over a plain light ground and turned out unreadable on a
real phone in dark mode, where cover artwork scrolls underneath it. The
selectable fill is the surface at ~64–68% — translucent on purpose, so the
atmosphere reads through — and never sits over artwork. The primary CTA
simulates the same layered translucency over an opaque base instead, because
nothing should bleed through a control carrying white text.

All of it is one recipe drawn from shared tokens, one hue parameter per
family. The chrome draws from `--glass-spec`, `--glass-inset` and
`--glass-edge` plus a directional rim shadow; selectables add `--select-fill`
and the accent-family halo (`--glass-glow`, low-alpha rasp/plum — stronger on
hover/focus, compressed on press); the primary CTA reuses the identical halo
tokens (`--glass-glow` / `--glass-glow-hot` / `--glass-glow-press`, untouched)
and swaps in a rasp-hued series — `--btn-base` (opaque deepened base),
`--btn-grad` (82–90% alpha stops, top rim lit), `--btn-sheen` (faint
rasp-tinted falloff), `--btn-inset` (1px specular top edge, .55 fading by ~30%
to .385) and `--btn-edge` (rasp-pearl hairline, ~68% white on light, 50% pearl
on dark). The chrome takes a directional rim shadow; selectables and the
primary take the halo. Future tweaks edit the tokens, not the call sites.

### The primary CTA

Every `.btn--primary` in the app — Continue, Sign in, Try again,
create-profile submits — is one material derived from the same tokens as
the bar, the rail, the selectables and the close button. Painted
bottom-to-top: opaque `--btn-base` (`#8f002e` light / `#6d0023` dark), the
82–90% alpha `--btn-grad` (top stop `#d2104e`, deepening toward the base),
then `--btn-sheen`, then the halo. White text holds
≥ 4.5:1 at every row of the fill in both themes (4.77 light / 4.91 dark,
sheen included); the previous flat `--rasp` slab ran 3.4:1 (light) and
2.9:1 (dark). Hover strengthens the halo one notch and travels 1px;
press travels 3px into the shadow and compresses it to the press tier;
focus-visible keeps the global cobalt ring. No `backdrop-filter` — the
translucency is simulated in the layered fill.

## Composition rules

- **A 2px ink border with a real offset shadow**, never a soft rounded
  rectangle standing in for a panel.
- **More space above a heading than below it.**
- **No kicker or eyebrow above a heading.** The heading speaks for itself.
- **A book looks identical everywhere it appears** — grid, shelf and dock all use
  `ShellCover`.
- **44px minimum touch targets.** The scrubber is 44px tall with a 30px grip;
  the default range input thumb is about 4px and unusable in bed.
- **Hover may reveal, touch must not depend on it.** Card actions are always
  visible below `sm`.

## Layering

Component classes live in `@layer components`. Unlayered rules beat Tailwind's
layered utilities, which silently defeated `hidden` on `.btn` and `fixed` on
`.rail`. Position and layout belong to the component's markup; the classes supply
material only.

## Gotchas

These are documented at length in spec 15 and each one cost real time:

- A bare `/* */` in JSX children position renders as text. Braces required.
- `backdrop-filter` on an ancestor makes it the containing block for its
  `position: fixed` descendants.
- A pseudo-element on a `static` element resolves `inset` against the nearest
  *positioned* ancestor.
- Grid items default to `min-width: auto`; `min-w-0` belongs on the grid item.

## Verifying a change

```bash
npm --prefix client run test                 # 895 unit tests
npx playwright test                          # 40 E2E, needs a running stack
node scripts/capture-ui.js                   # screenshots + layout guards
```

`capture-ui.js` exits non-zero if the document scrolls sideways, if the detail
dialog scrolls internally, or if a comment or `TODO` is visible on screen. It is
the cheapest check in the repo and catches the class of bug the type system
cannot.