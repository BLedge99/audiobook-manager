# GLOSSARY

Domain terminology and ubiquitous language for the audiobook manager.

### Core Domain Entities
- **Audiobook / MediaItem:** An audio recording of a book composed of one or more tracks/files, metadata, and optional chapter divisions.
- **LibraryRoot:** A configured physical root directory on the server containing audiobook files and subdirectories.
- **Track:** A discrete media file belonging to an audiobook, possessing duration, track number, and format.
- **Chapter:** A named section within an audiobook, either derived from file boundaries or embedded chapter marks within single-file audio.

### Authentication & Profiles
- **Profile:** A user identity within the household holding independent listening history, playback progress, and favourites.
- **Household:** The primary shared environment/network holding the library and server.
- **Session:** An authenticated client grant tokenized via session tokens and stored with expiry.
- **Break-Glass Key / Household Password:** The master administrative password for first-run claim and account recovery.
- **WebAuthn / Passkey:** Public-key cryptographic credentials stored per profile for passwordless authentication.
- **Device Credential:** A long-lived, 90-day device-bound cryptographic credential allowing device offline exchange.

### Metadata & Discovery
- **Enrichment:** Automated retrieval and synthesis of book metadata from external providers (Open Library, Google Books, LibriVox, Audnexus).
- **Field Override:** Explicit user modifications to individual metadata fields (`FieldOverride` table) taking precedence over enriched and embedded data per ADR 009.
- **Precedence Chain:** The strict evaluation hierarchy for book metadata: `user override > enriched > embedded > derived/filename`.
- **Shelf:** A horizontal browse grouping based on genre, author, series, or activity status.

### Player & Playback
- **Player Controller:** The client module controlling audio position, transport (play/pause/seek), track selection, and audio events.
- **Position Model (ADR 017):** Invariant where playback position is an independent player state rather than coupled to the raw media element or source lifecycle.
- **Replica / Device Library:** The local SQLite / IndexedDB cache of audiobook files and metadata stored directly on client devices for offline playback.
