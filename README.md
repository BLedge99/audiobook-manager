# Audiobook Manager

A simple, private way to enjoy your household's audiobook collection on any phone, tablet, or computer in your home.

## What this is

Audiobook Manager turns a folder of audiobook files into a ready-to-listen library, much like a streaming service you would subscribe to — except it lives entirely in your home, on your own hardware, and only the people in your household can use it.

You point it at the folders where your audiobooks live, and it does the rest: it reads the files, pulls in covers and descriptions, organises everything into a browsable library, and lets anyone in the household play books, pause, speed them up, set a sleep timer, and pick up exactly where they left off — even switching from one device to another.

It is built for families and households, not for public sharing. There are no accounts to create, no subscriptions, and no data sent to social networks. Everything stays on your own device.

## Who it is for

- **Household members:** anyone at home who wants to browse and listen without worrying about files, folders, or how the technology works.
- **The person who sets it up:** one person adds the library folders, starts the scan, and keeps the server running. No programming skills are needed for day-to-day use.
- **The host:** a computer that stays on at home — anything from an everyday PC to a small, low-power device like a Raspberry Pi.

## Quick start

1. **Start the server.** Run the startup command for your setup (usually one command that brings everything up).
2. **Add your audiobooks.** Point the server at the folders on your computer or network where your audiobook files are stored.
3. **Run a scan.** The server reads your files, figures out which belong to the same book, and pulls in cover art and details where it can find them.
4. **Open the app.** On any phone, tablet, or computer connected to your home Wi-Fi, open the app address shown when the server starts.
5. **Pick a profile and listen.** Each household member can have their own profile so their place in a book, favourites, and history are kept separate.

The app works in a web browser on desktop, and as an installable app on Android phones. No special software is needed on the devices you listen with.

## What it does

**Browse your library**
- A Netflix-style grid of your books with cover art, authors, and narrators
- Search across titles, authors, narrators, series, and genres
- Shelves organised by genre, series, and other categories
- A "Continue listening" shelf so you can pick up where you left off

**Play books**
- Play with chapters, adjustable playback speed, and a sleep timer
- Resume exactly where you stopped, even on a different device
- Per-user progress and listening history
- Lock-screen and background playback on supported phones

**Keep things organised**
- Each household member has their own profile with separate progress and favourites
- Books can be matched to online records to fill in missing covers and descriptions
- You can confirm or correct matches yourself — your corrections always win
- Your audio files are never changed or tagged by the app

**Listen on your phone**
- Install the app on an Android phone so it feels like a native app
- Download books to the phone so you can listen without a network connection
- Choose **Continue offline** to keep the app disconnected until you explicitly reconnect in Settings
- Offline listening uses downloads on the phone; progress syncs after you reconnect

## Things worth knowing

- **It works on your home network only.** The app is designed to be used by devices connected to your home Wi-Fi. It is not intended to be accessed from outside your home, and there is no remote-access feature built in.
- **Profiles have their own sign-in.** The household password is used to create or recover a profile; each person signs in with their own profile password or device biometric.
- **Your files are safe.** The app only reads your audiobooks. It never writes metadata into your files, moves them, or deletes them.
- **Online lookups are optional.** The app can look up covers and descriptions online, but it works perfectly well without them. Any AI-assisted features are optional and never required to browse or play.
- **It keeps running in the background.** Once started, the server stays running so your household can listen at any time. It survives restarts and picks up where it left off.
- **Android first for mobile.** The phone experience is built for Android. iPhones and iPads can use the website in a browser, but there is no dedicated Apple app.

## Getting help

If something is not working, the best place to start is checking that the server is running and that your phone or computer is on the same home network. For setup details specific to your environment, look in the project documentation folder.

---

*Audiobook Manager — your household's audiobooks, on every device at home.*
