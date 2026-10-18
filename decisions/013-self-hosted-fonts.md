# ADR 013 — Fonts are self-hosted, not linked from a CDN

## Status

Accepted. Implemented by [`specs/15-gui-redesign.md`](../specs/15-gui-redesign.md).

## Context

The client is three things at once: a desktop browser app, an installable PWA, and
a Capacitor APK that is sideloaded onto household phones. Two of those three have
to work with no internet at all.

That constraint is not hypothetical. The whole point of the download feature is
listening on a plane or in a basement: spec 26 makes a downloaded book playable
with the network off, and `local/replica.ts` keeps a read replica in IndexedDB so
the shelf still renders offline. A design that reaches the network to render its
own typography contradicts the one feature that justifies the app.

The obvious cheap answer is the usual one: a `<link>` to `fonts.googleapis.com`
in `index.html`. It is one line, it is what Vite's docs show, and it is why the
incumbent prototype linked no font at all and fell back to `system-ui`.

## Decision

Bundle the faces in the repository and serve them from the app's own origin.

Fredoka (display) and Nunito (text), latin subsets only, as woff2 in
`client/public/fonts/`, declared with `@font-face` in `index.css`. **69KB total.**

## Alternatives rejected

**Google Fonts `<link>`.** Zero bytes in the repo, but a phone in airplane mode
renders in the fallback face, and a sideloaded APK with no Play Services has no
guarantee of reaching Google at all. The design would silently be a different
design offline — and the offline case is the product.

**Self-host the full character set.** Would have cost several megabytes per face
for glyphs the app never renders. The library is English-language audiobook
metadata; latin is the whole requirement. If a non-latin title ever needs to
render, that is when unicode-range subsets get added, not a preemptive choice.

**Use the platform sans (`system-ui`, `Roboto`).** Free and offline by
definition. Rejected because it is exactly the failure the redesign exists to
fix: Roboto is what every Android app already looks like, and a design whose
voice is "whatever the phone has" has no voice. The cost is 69KB, which is not a
trade worth making in the other direction.

## Consequences

- A face change is a binary diff and a reviewable commit, not a vendor-side
  change nobody sees.
- No third-party request from a household app, which is worth something on its
  own: the phone is talking to exactly one host, the user's own server.
- The subset is a real constraint. A title in a script outside latin falls back
  to the system font. That is acceptable degradation, not a rendering bug, but it
  should be known rather than discovered by a listener.
- `font-display: swap` is set, so text is never invisible while a face loads. On
  the local origin the load is effectively instant.