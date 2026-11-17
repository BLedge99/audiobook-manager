# Early design diagrams (2026-09 to 2026-10)

**Reconstructed from git history on 2026-11-17 — not contemporaneous documents.**
The project had no design system, no wireframes and no screenshots at the time
its first UI was written; these diagrams are drawn from the code as it existed
at the commits below, and are labelled with those commits so the reconstruction
is auditable (`git show <sha>:client/src/...`).

| Diagram | Reconstructed from | What it shows |
|---|---|---|
| [`2026-09-22-initial-scaffold.svg`](2026-09-22-initial-scaffold.svg) | `25d3000` (initial commit, 2026-09-22) | The very first screen: fixed top bar, a "Featured" row of three cards, an "All Audiobooks" grid, footer. Dark slate with a **blue-500** accent; all data was mock data. |
| [`2026-09-23-scanner-wired.svg`](2026-09-23-scanner-wired.svg) | `771731c` (2026-09-23) | First real data flow: hero ("Browse your books.") + Scan button, the library-folders management section, and the responsive grid with duration badges. Palette settled on **#0b1117 + cyan (#22d3ee)**. |
| [`2026-09-23-detail-dialog.svg`](2026-09-23-detail-dialog.svg) | `771731c` | The book-detail modal: dimmed backdrop, two-column cover/content layout, native `<audio>` element and a cyan CTA. |
| [`2026-10-02-auth-gate.svg`](2026-10-02-auth-gate.svg) | `99f6dbb` (2026-10-02) | The household-password gate (LoginGate) and profile switcher added with auth. |

Common traits of this era, for contrast with what shipped in spec 15 (the
2026-10-18 capsule-vending redesign documented in `DESIGN.md`):

- Flat, border-and-slate surfaces; no radii language; no motion tokens.
- One accent colour (cyan) used both decoratively and as the primary action.
- No mobile-specific design; the layout reflowed rather than adapted.
- Everything below the fold was a single grid with `xl:grid-cols-5`.

These were not made before coding — they were drawn from the code afterwards,
with the commit SHAs as receipts.
