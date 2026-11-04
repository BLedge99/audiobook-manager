# Spec 34 — Production book uploads

## Purpose

The production server has no local media folder the operator can populate, and
the current admin panel is on a second listener that Render does not expose.
The operator needs to upload an already-extracted book folder and make it
available to the existing scanner, library, and playback routes.

## Decision

- The admin panel is reachable on the production origin at `/admin` and
  `/api/admin/*` through a same-process proxy to the existing admin listener.
  The admin password/session remain the only authorization mechanism; the
  family API never handles admin session validation.
- Audio is stored in a **private Supabase Storage bucket**. The server uses a
  service-role key and issues short-lived signed upload URLs only after an
  admin session is validated. The service-role key never reaches the browser.
- The browser can upload an extracted folder, preserving relative paths under
  `books/<folder>/`, or multiple selected audio files grouped under an
  operator-entered book name. Only supported audio extensions are accepted,
  each file must be at most 50 MB, and paths cannot escape that prefix.
- The server synchronizes bucket audio into `SUPABASE_CACHE_DIR`, registers
  that directory as a library root, then runs the existing scanner and
  enrichment pipeline. A startup synchronization rebuilds the disposable
  cache after a Render restart. No stale remote objects or local files are
  automatically deleted.

## Acceptance criteria

1. `/admin` and all admin API requests work through the production web port;
   the separate `ADMIN_PORT` remains available for local use.
2. No admin route is exposed when the public server is built without an
   explicit internal admin target. An admin session is still required for
   upload URL creation and sync requests.
3. Missing or partial Supabase configuration is reported explicitly; when
   unconfigured, the normal scanner and admin panel continue to work without
   an upload action.
4. Upload URL requests reject unsafe names, traversal, non-audio paths, and
   unsupported extensions. Signed URLs are private, short-lived, and do not
   expose server credentials.
5. Sync lists and downloads only supported audio files under `books/`, writes
   them atomically inside the configured cache, registers the cache root, and
   scans/enqueues enrichment. Restart sync is safe to repeat.
6. The panel clearly explains the per-file 50 MB limit and that uploads must
   be extracted audio files; file selection provides a book-name fallback for
   browsers where folder selection is unavailable.
7. Tests cover proxy routing, upload validation, storage API failures, sync
   path confinement, and existing scan integration. Setup documentation
   explains required Render variables, private bucket creation, and Supabase's
   separate database and file-storage quotas.

## Operational limits

- The Supabase Free plan's database quota is not file storage. Confirm current
  storage and per-file limits in the Supabase dashboard; the documented
  initial Free-plan per-file limit is 50 MB.
- Render's local cache is disposable. Durable source audio is the private
  bucket, and cache recreation requires sufficient instance disk and network
  capacity at startup.
- The first implementation syncs all audio objects at startup and when
  explicitly requested. It does not delete remote objects or infer that a
  missing remote file should be removed from the library.
