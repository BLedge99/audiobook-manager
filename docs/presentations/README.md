# Presentations

Slide decks and materials for the Audiobook Manager showcase. Self-contained HTML,
no network dependencies (fonts are self-hosted from `showcase/assets/fonts/`).

- `architecture/` — timeline of the architecture's evolution (2026-09-22 → 2026-11-17)
- `design/` — timeline of the GUI/design evolution
- `showcase/` — the five-to-ten-minute course showcase deck (`index.html`), plus
  speaker notes (`notes.html`) and `PLAN.md` (format and slide map)

Open `index.html` in a browser; nothing needs to be installed or built.

## Music attribution

`showcase/video/audio/motivator.mp3` is **Motivator** by Kevin MacLeod
([incompetech.com](https://incompetech.com)), licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The credit must appear
(on screen or in the video description) whenever the track is used.

## Deliberately not in git

The rejected automated showcase-video scaffold (a generated React/Vite tap-through
demo and Kokoro TTS voice samples) was removed before this commit. The showcase
video is built manually; only the script, brief, outline and music track live here.
