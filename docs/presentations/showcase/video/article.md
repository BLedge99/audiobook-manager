# Audiobook Manager — Project Brief

**The idea in one line:** audiobook platforms are a mess, and none of them
support good old raw audio files — turn your files into a single place the
whole household can browse, press play, and pick up where they left off, like
a streaming service, but only for your home and your files.

## What it is

Audiobook Manager is an app for a household. Someone points it at their
audiobook files on a home computer, and it does the rest: it reads the files,
fetches covers and descriptions, groups books into series, and tracks playback
position for each and every book you listen to. Anyone in the house can open
the app on a phone or computer and listen.

It is built for one house, not for the public. There are no adverts, no
subscriptions, and nothing leaves your network unless you choose to look
covers up online. The files themselves are treated as read-only — the app
never edits, moves or deletes your audiobooks.

## Who it is for

- **Household members** — children and adults who just want to find a book
  and press play. No setup, no accounts to invent, no files to worry about.
- **Whoever sets it up** — the one technical-ish person in the house. Point it
  at your audiobook files, and it works out the rest.
- **The house itself** — it runs on an always-on computer at home, like a home
  media server or, eventually, a Raspberry Pi.

## Main features

- **Browse your books** — books are displayed as covers on shelves, sorted by
  genre and series, with a "Continue listening" row that shows what you were
  half-way through. Search included.
- **Press play** — chapters, speed, a sleep timer, and no faffing about with
  files. A card opens showing the player, the book's chapters and its
  information. Progress is stored on the server, so you can stop on your
  phone and carry on on your laptop.
- **One profile each** — every household member keeps their own place in
  every book, their favourites and their history.
- **Kids, gently** — kids accounts set an age band, so inappropriate books
  simply don't show.
- **Works away from home** — on Android, books can be downloaded offline and
  taken with the phone; listening position is saved locally and progress is
  synced when you're back.
- **Better pictures, automatically** — the app looks up proper covers and book
  details online, but always lets a human say "no, use mine", and never has to
  be online: everything works with the internet off.

## Privacy and your data

- **Works with the internet off** — the app, its covers cache and your
  downloads all function without a network connection.
- **Online lookups send book details only** — cover and description queries
  go out with the book's title/author, never anything about the people in
  your house.
- **Protected under the GDPR retention policy** — your data can be exported
  or erased on request.
- Nothing about your listening is shared outside the household unless you
  sign up for the demo yourself.

## Which API it uses

- **Its own API.** The server and the app talk to each other through a REST
  API built with Node.js, Fastify and Prisma (SQLite on a home machine,
  PostgreSQL for the hosted version). The React web app and the Android app
  both use it.
- **Free, public book catalogues** for covers and details: Open Library and
  LibriVox (no key needed) and Google Books (optional key). Queries carry
  book details only — never anything about the people in your house.
- **An optional AI helper** (LM Studio, running locally) suggests which book
  it thinks a file is; it never decides on its own and is never required.
- **A free demo** of the web version is hosted online so people can try it
  without installing anything — this is what the QR code in the video points
  to.

## What it deliberately does not do

- No social features, stranger reviews or public sharing.
- No editing or tagging of your audiobook files.
- No iPhone app (the website works in Safari; Android gets the app).
