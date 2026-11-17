# Audiobook Manager — Project Brief

**The idea in one line:** turn a folder of audiobook files into a place the
whole household can browse, press play, and pick up where they left off —
like a streaming service, but only for your home and your files.

## What it is

Audiobook Manager is an app for a household. Someone points it at the folders
where the audiobooks live on a home computer, and it does the rest: it reads
the files, fills in missing covers and descriptions, and makes everything
browsable. Anyone in the house can open the app on a phone or computer and
listen.

It is built for one house, not for the public. There are no adverts, no
subscriptions, and nothing leaves your network unless you choose to look
covers up online. The files themselves are treated as read-only — the app
never edits, moves or deletes your audiobooks.

## Who it is for

- **Household members** — children and adults who just want to find a book
  and press play. No setup, no accounts to invent, no files to worry about.
- **Whoever sets it up** — the one technical-ish person in the house. Point it
  at the folders, press start, and it works out the rest.
- **The house itself** — it runs on an always-on computer at home, like a home
  media server or, eventually, a Raspberry Pi.

## Main features

- **Browse your books** — a cover-art grid, search, shelves by genre and
  series, and a "continue listening" row that shows what you were half-way
  through.
- **Press play** — chapters, speed, a sleep timer, and no faffing about with
  files. Stop on your phone in the kitchen, carry on on the laptop upstairs.
- **One profile each** — every household member keeps their own place in
  every book, their favourites and their history.
- **Kids, gently** — an adult can set an age band per child; too-grown-up
  books simply don't show.
- **Works away from home** — on Android, books can be taken with the phone
  and listened to without Wi-Fi; progress catches up when you reconnect.
- **Better pictures, automatically** — the app looks up proper covers and book
  details online, but always lets a human say "no, use mine", and never has to
  be online: everything works with the internet off.

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
  without installing anything.

## What it deliberately does not do

- No social features, stranger reviews or public sharing.
- No editing or tagging of your audiobook files.
- No iPhone app (the website works in Safari; Android gets the app).
- Nothing about your listening is shared outside the household unless you
  sign up for the demo yourself.
