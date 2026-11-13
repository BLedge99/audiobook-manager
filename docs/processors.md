# Third-Party Processors & DPAs — GDPR Art. 28

**Last updated:** 5 November 2026  
**Status:** Draft — implements Phase 7 of `docs/GDPR-REMEDIATION-PLAN.md`  
**Review cycle:** Reviewed on every new external integration, at least annually, and before the production demo goes live.

## Core control

**No personal data is sent to any third party in normal operation.** All catalogue enrichment queries send only non-personal book identifiers (ISBN, title, author, ASIN, provider key) — never profile identity, reading history, favourites, wishlist, or any other personal data. This is a design control, not a best-effort promise: enrichment providers are queried server-side with book metadata only, and responses are stored as catalogue metadata (`MediaItem`), not as personal data.

---

## Processor inventory

| # | Processor | Purpose | Receives personal data? | Data transferred | DPA / terms | Notes |
|---|-----------|---------|------------------------|------------------|-------------|-------|
| 1 | **Open Library** (openlibrary.org) | Catalogue enrichment — cover, title, author, edition metadata | **No** | Book identifiers only (ISBN/title/author) | Public API, no DPA required (no personal data) | Used by default enrichment chain; query params contain no user identifiers |
| 2 | **LibriVox** (librivox.org) | Public domain audiobook source and metadata | **No** | Book identifiers only (title/author/project ID) | Public API, no DPA required (no personal data) | Also called server-side by `GET /api/buy-context` (spec 39) for the "Free" row; identifiers only, in-memory 5-minute cache, never logged; no personal data in queries |
| 3 | **Audnexus** (audnexus.com) | Catalogue enrichment — Audible metadata matching | **No** | Book identifiers only (ASIN/title/author) | Public API, no DPA required (no personal data) | Optional provider in the enrichment chain |
| 4 | **Google Books** (books.google.com) | Optional catalogue enrichment (requires API key) | **No** | Book identifiers only (ISBN/title/author) | Google API Terms of Service; no DPA required (no personal data) | Only enabled when `GOOGLE_BOOKS_API_KEY` is configured; key is server-side only |
| 5 | **LM Studio** (local) | Optional local AI — metadata match assistant, description summary | **No** | Book metadata + folder names only | Local instance only; not a third-party processor | Runs on the user's own hardware; degrades gracefully offline; user confirms before applying suggestions |
| 6 | **Supabase Storage** (supabase.com) | Optional server-side audiobook file sync (private bucket) | **No** | Audiobook files and catalogue metadata only | Supabase DPA applies if enabled | Server-side service-role key only; private bucket; not enabled by default; see `.env.production.example` |

---

## Sub-processors

No sub-processors are engaged. The six processors listed above are the only external recipients, and none receive personal data.

---

## International transfers

No personal data is transferred outside the server's jurisdiction. Catalogue enrichment queries may reach public APIs hosted outside the EEA/UK (e.g. Open Library, Google Books), but those queries carry book identifiers only — no personal data about any user.

---

## Customer / user instructions

- **Household deployment:** No external processors receive personal data. No action required.
- **Production demo:** Same. If Supabase Storage is enabled, confirm the Supabase DPA applies and note it in `.env.production.example`.
- **Enrichment provider changes:** Any new external integration must be added to this inventory before deployment, with a determination of whether it receives personal data.

---

## Cross-reference

- RoPA Activity 9: `docs/roa.md` — external catalogue enrichment (no personal data sent).
- RoPA Activity 10: `docs/roa.md` — optional AI via LM Studio (local, no personal data).
- RoPA Activity 11: `docs/roa.md` — optional Supabase Storage sync (no personal data).
- RoPA Activity 12: `docs/roa.md` — kids accounts (2026-11-12). Age suggestions use the same identifiers-only provider calls; no new processor, recipient or data category was introduced. Kids-account age band is processed only by the household server.
- Governance: `docs/gdpr-governance.md` — data-protection lead owns the processor inventory.
- Audit: `GDPR-AUDIT.md` §5 — third-party processor findings.
