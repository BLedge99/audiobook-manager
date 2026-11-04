# Production book uploads

The production admin panel is available at `https://<your-host>/admin`. It
still uses `ADMIN_PANEL_PASSWORD`, which is separate from household sign-in.
The panel uploads audio to private Supabase Storage and asks the server to
download the files into its local cache, register that cache as a library
folder, scan it, and enqueue enrichment.

## Configure Supabase

1. In the Supabase project used for production, open **Storage** and create a
   bucket named `audiobooks` (or choose another name for
   `SUPABASE_STORAGE_BUCKET`).
2. Keep the bucket **private**. The server checks this before issuing upload
   URLs or synchronizing objects.
3. Keep the maximum individual file size at 50 MB or less. The upload UI
   rejects larger files. The Supabase database quota and Storage file quota are
   separate; audio objects do not use the PostgreSQL database quota.
4. Copy the project URL and the server-side `service_role` key from the
   project's API settings, not the publishable/`anon` key. Never put the
   service-role key in the React client, a public environment variable, or
   source control.

## Configure Render

Add these environment variables to the Render web service:

```text
ADMIN_PANEL_PASSWORD=<a new, strong password used only for the operator panel>
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<server-only service-role key>
SUPABASE_STORAGE_BUCKET=audiobooks
SUPABASE_CACHE_DIR=/data/audiobooks
```

Save the variables and let Render redeploy. `/admin` then opens the existing
admin panel through the public web port. Sign in with `ADMIN_PANEL_PASSWORD`;
do not use `APP_PASSWORD` or an OAuth household account.

The cache is local to the Render instance, not durable storage. Supabase Storage
is the durable copy. At startup, the server downloads the bucket's audio
objects again before scanning them. The instance therefore needs enough free
disk for a complete local copy of the library, and a restart may take longer
while audio is downloaded. The app does not automatically delete objects from
the bucket.

If the Render service has a persistent disk mounted at `/data`, add
`COVER_DIR=/data/covers` to keep covers there too. Without a persistent disk,
covers saved only on the instance can disappear on deploy; startup scanning
clears missing cover-file references and retries enrichment for books that
still have no cover.

## Upload a book

1. Unzip the LibriVox book on your computer first.
2. Open `/admin` on the production host and sign in.
3. In **Upload audiobook tracks**, enter the book name, then choose its audio
   tracks together. The upload puts them in one folder named after the book,
   regardless of the local folder-picker behavior.
4. Confirm the selected audio files, then choose **Upload selected files**.
   Files are uploaded one by one; each must be 50 MB or smaller.
5. The server syncs the private bucket to its cache and scans it. The book
   appears in the shared library after the scan completes.

For example, selecting the tracks from `The Time Machine` and entering that
book name uploads them under `books/The Time Machine/`. Do not upload ZIP files
or non-audio files.
