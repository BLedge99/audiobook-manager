# Spec 15 — GUI redesign

## Purpose

The app worked and looked like a prototype: dark slate, cyan accents, no visual
system, and a desktop layout that was reflowed rather than designed for the phone
it mostly runs on. Every surface had been styled on its own, so the library
grid, the browse shelves, the player and the gates shared no component
vocabulary. The result read as an internal tool.

This spec restyles the client as one system, mobile first, without changing what
the app does.

> **Written after the fact.** The work landed on 2026-10-18 and this file was
> authored the same day from the finished build. Per `AGENTS.md` a feature needs
> its spec *before* the code; this one was missed, and the note is recorded here
> rather than hidden. What follows is the contract the build actually holds
> itself to, not a plan that preceded it.

## Scope

All twenty client surfaces: splash and offline notice, server setup, login,
profile gate, profile switcher, the four tabs (Library, Browse, Discover,
Favourites), book detail, the chapter player, settings, and the operator
screens for library folders, scanning, the enrichment review queue and tags.

Explicitly out of scope: every behaviour change. No prop, hook, handler, refetch
trigger, API call, accessible name or route changes. This is a restyle.

## The direction

Injection-moulded capsule vending, drawn by hand.

Every book is a canted 3° acrylic capsule: a marker-inked outline, a crown seam,
two screw dimples, and the **real cover art read through tinted plastic** rather
than sitting on top of it. The raspberry play dome is the only glossy, spherical
element in the app; everything else is flat and outlined. Cute energy runs
uniformly across every surface, operator screens included.

Three disciplines were carried into the world from alternatives that were
considered and declined:

1. **Persistent change state** — an item awaiting a decision holds its mark until
   someone actually looks at it, instead of quietly blending back in.
2. **No colour travels alone** — every status colour ships with a written
   legend, so the palette never has to be decoded by eye.
3. **Whole-module geometry** — radii, studs and dot grids snap to integers so
   nothing smears at 360px.

The direction was chosen by the user from five presented options and then
re-steered by them: livelier and whackier, tilt and sketch character, minimal
interiors, real transparency. `DESIGN.md` records the built system.

## Behaviour

### The dock leads

The Library tab opens on the dock and the shelf. Every operator control — scan,
library folders, enrichment status, the review queue — comes *after* the books.

This is the one structural change. The previous order put the hero, the scan
button and the folder list above the books, so the signature element never
appeared in the first viewport on any device. A listener should see what they
have, not what the operator maintains.

### One nav, two placements

The tab rail is a single `<nav aria-label="Sections">`. On a phone it is fixed
to the bottom with frosted glass over scrolling content; from `sm` up it returns
to the flow as a row under the header. It stays one element because two navs
make `e2e/library-browse.spec.ts`'s
`getByRole("navigation", { name: "Sections" })` ambiguous.

### Theme

Light, dark and follow-the-device, persisted in `localStorage` and applied
before first paint by an inline script in `index.html`. Dark is the same machine
lit from inside, not an inverted palette: the acrylic gloss drops to a faint
highlight and the shell tints lighten under it.

## Acceptance criteria

1. Every one of the twenty surfaces uses the shared tokens and primitives. No
   screen carries its own colour values.
2. Light and dark both pass WCAG 2.2 AA for body text. Accents carry fills; the
   `-ink` variants carry text.
3. `text-size-adjust: 100%` survives, and no `maximum-scale` or
   `user-scalable=no` is added to the viewport meta.
4. No horizontal scrolling at 320, 360, 390 or 412px — `e2e/phone-layout.spec.ts`
   passes unchanged.
5. The detail dialog does not scroll sideways inside itself. Its DOM stays
   `div.fixed.inset-0 > article`, because the E2E suite locates it that way.
6. All 266 client unit tests and all 40 Playwright tests pass without editing a
   single assertion.
7. `prefers-reduced-motion: reduce` disables the particle burst and the ambient
   field, and the app remains fully usable.
8. Fonts are self-hosted, so the installed app works with no network.

## Traps recorded here, because each one cost real time

**A block comment left bare in JSX children position is text and renders.** A
comment added while fixing `main`'s padding shipped to a Pixel 4a as a paragraph
of CSS commentary at the top of the Library tab. It passed `tsc`, all 266 unit
tests and all 40 Playwright tests, and survived two rounds of screenshot review.
Only a person looking at the actual phone caught it. The braces are mandatory:
`{/* ... */}`. `scripts/capture-ui.js` now fails the build if a comment or a
`TODO` is visible on screen.

**Unlayered CSS beats Tailwind utilities.** Component classes must live in
`@layer components`. Left unlayered, `.btn { display: inline-flex }` silently
defeated a `hidden` utility and `.rail { position: sticky }` defeated
`fixed bottom-0`.

**`backdrop-filter` on an ancestor traps `position: fixed` descendants.** The
header's frosted glass made the header the containing block for the fixed tab
rail, so the rail anchored to the header instead of the viewport. The bar's glass
moved to a pseudo-element.

**A pseudo-element on a `static` element resolves its `inset` against the nearest
positioned ancestor.** The rail's pseudo-element then spanned the whole header,
and because hit-testing attributes a pseudo-element to its originating element,
the rail swallowed every click in the header. Only the desktop E2E run caught it.

**A grid item defaults to `min-width: auto`.** One unbreakable value — a Windows
path like `C:\Users\...\audiobook-manager\test` — set a panel's min-content width
and blew the page sideways. `min-w-0` on the grid item, not only its child.

## Known gaps this spec does not close

- The wordmark still reads "Audiobook Manager". `e2e/helpers.ts:42` matches the
  `<h1>` by exact accessible name, and `PRODUCT.md` records that the rename is
  not yet scheduled.
- The library is fetched once at mount, before a profile exists, so progress
  does not appear until the next fetch. Pre-existing, and the dock makes it more
  visible. See `LIMITATIONS.md`.