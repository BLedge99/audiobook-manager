# Audiobook Manager

A local-first web application that scans your storage for audiobook files, enriches them with online metadata, and presents them in a Netflix-style browsing interface. Integrates with LM Studio for AI-powered features.

## Features

- Scan local directories for audiobook files (MP3, M4B, FLAC, OGG, WAV)
- Parse embedded metadata, chapters, and cover art using FFmpeg and music-metadata
- Enrich library data via online APIs (Audible, Open Library, MusicBrainz)
- Netflix-style grid UI with search, filtering, and playback controls
- AI integration through LM Studio's OpenAI-compatible API for metadata assistance and recommendations

## Tech Stack

- **Frontend:** React + Vite + TypeScript + Tailwind CSS + shadcn/ui
- **Backend:** Node.js + Fastify + Prisma ORM
- **Database:** SQLite (with PostgreSQL support via Prisma)
- **Media Processing:** FFmpeg / ffprobe, fluent-ffmpeg, music-metadata
- **AI Integration:** LM Studio local models

## Getting Started

This project uses Docker Compose with a Makefile for easy management.

```bash
# Start all services
make start

# Stop all services
make stop

# View logs
make logs

# Trigger a library scan
make scan

# Tear down and rebuild from scratch
make reset
```

The client will be available at `http://localhost:5173` and the API server at `http://localhost:3000`.

## Acknowledgements

This project was partially vibe coded using [Bionic](https://lmstudio.ai/bionic) and Qwen 3.8 27B.