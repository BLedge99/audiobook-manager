/**
 * Every user-facing string in the admin panel.
 *
 * Spec 31. The panel does not inherit the family client's shell or voice: it
 * is a plain, dense, operator-grade UI. So its copy lives beside the family
 * catalog (`../copy.ts`, listener-facing) but is held to *operator* rules
 * instead of listener ones — `npm run check:copy` checks the export name
 * against the `professional-b2b` profile, while `src/copy.ts` runs against
 * `consumer-plain`.
 *
 * The vocabulary follows the panel's term table, which it deliberately shares
 * with `copy.operator`: **folder** (never "directory" or "root"), **scan**,
 * **enrichment**.
 *
 * Same mechanics as the family catalog: complete sentences, values passed as
 * arguments (never spliced into fragments), one `…` character, no exclamation
 * marks, and a repeated phrase is a shared entry, not a copy of itself.
 *
 * Three deliberate exceptions live in `scripts/copy.config.json`, where they
 * can be reviewed against the checks they skip:
 *
 * - `copyAdmin.db.nullDisplay` ("NULL") is the database term of art and is
 *   exempted from the all-caps check rather than lowered into a lie.
 * - `copyAdmin.fields.yes` and `copyAdmin.fields.no` are always rendered as a
 *   row value directly under a yes/no question ("Configured?"), so the
 *   checker's vague-command rule, written for action buttons, does not apply.
 */

export const copyAdmin = {
  /** The gate the panel boots into while the admin session is being read. */
  session: {
    checking: "Checking admin session…",
  },

  locked: {
    heading: "Admin panel locked",
    body: "Set ADMIN_PANEL_PASSWORD in the server environment, then restart the server.",
  },

  signIn: {
    heading: "Admin sign in",
    hint: "Separate from your household account.",
    passwordLabel: "Admin password",
    submit: "Sign in",
    rejected: "The password was not accepted.",
    unavailable: "Unable to sign in.",
  },

  nav: {
    label: "Admin sections",
    overview: "Overview",
    database: "Database",
    apiDocs: "API docs",
  },

  /** Top bar and the loading/error states shared by the whole dashboard. */
  shell: {
    title: "Admin panel",
    subtitle: "Read-only system and library report · refreshes every 15 seconds",
    refresh: "Refresh",
    signOut: "Sign out",
    loading: "Loading server status…",
    statusRequestFailed: "Status request failed.",
    loadFailed: "Unable to load server status.",
    requestFailed: "Request failed.",
  },

  cards: {
    env: "Environment",
    server: "Server",
    db: "Database",
    library: "Library",
    network: "Network configuration",
    enrichment: "Enrichment",
  },

  fields: {
    mode: "Mode",
    remoteAccess: "Remote access",
    reported: "Reported",
    health: "Health",
    node: "Node",
    platform: "Platform",
    uptime: "Uptime",
    type: "Type",
    configured: "Configured",
    yes: "Yes",
    no: "No",
    books: "Books",
    profiles: "Profiles",
    folders: "Folders",
    latestScan: "Latest scan",
    newestShelfAddition: "Newest shelf addition",
    familyPort: "Family API port",
    adminPort: "Admin port",
    webauthnRp: "WebAuthn RP",
    webauthnOrigin: "WebAuthn origin",
    mediaSigningKey: "Media signing key",
    notConfigured: "Not configured",
    signingKeyMissing: "Missing / too short",
    tunnel: "Tunnel",
    status: "Status",
    queued: "Queued",
    processed: "Processed",
    appliedReview: "Applied / review",
    failedSkipped: "Failed / skipped",
    lastFinished: "Last finished",
    allowedOrigins: "Allowed client origins",
  },

  /**
   * Library roots: the add/remove/scan controls. "Folder" on purpose — the
   * family client's operator tier settled that word, and the panel shares it.
   */
  folders: {
    heading: "Library folders",
    scanAll: "Scan all folders",
    addFolder: "Add folder",
    pathLabel: "Folder path",
    pathPlaceholder: "/data/audiobooks",
    labelOptional: "Label (optional)",
    labelPlaceholder: "Audiobooks",
    accessible: "Accessible",
    unavailable: "Unavailable",
    bookCount: (count: number) => `${count} books`,
    scanState: (status: string) => `Scan: ${status}`,
    scanSummary: (count: number, when: string) => `${count} files · ${when}`,
    neverScanned: "Never scanned",
    scanOne: "Scan",
    remove: "Remove",
    empty: "No folders configured.",
    removeConfirm: (folder: string) =>
      `Remove folder configuration for “${folder}”? The audio files will not be deleted.`,
  },

  storage: {
    heading: "Upload audiobook tracks",
    explainer: "Enter the book name, then select its extracted audio tracks. The tracks are stored together in a folder named after the book and scanned into the library.",
    notConfigured: "Supabase Storage is not configured on this server.",
    chooseFiles: "Choose audio files",
    bookNameLabel: "Book name",
    bookNameRequired: "Enter the book name before uploading.",
    upload: "Upload selected files",
    sync: "Sync stored books now",
    uploading: (name: string, index: number, total: number) => `Uploading ${name} (${index} of ${total})…`,
    selectedFiles: (count: number) => `${count} audio files selected. Other file types are ignored.`,
    fileLimit: "Each audio file must be 50 MB or smaller. Larger files cannot be uploaded to this bucket.",
    folderRequired: "Choose one book folder before uploading.",
    noAudioFiles: "The selected folder contains no supported audio files.",
    fileTooLarge: (name: string) => `${name} is larger than 50 MB.`,
    uploadFailed: (name: string) => `Unable to upload ${name}.`,
    syncStarted: "Upload finished. Library sync has started.",
    syncBusy: "A library sync is already running. Wait for it to finish, then try again.",
    syncFailed: "The library sync failed. Check the server logs and try again.",
    state: (status: string, count: number) => `Storage sync: ${status} · ${count} files downloaded`,
  },

  /** Read-only database explorer. Writes are out of scope (spec 31). */
  db: {
    heading: "Read-only database explorer",
    explainer:
      "Browse tables or run one select, explain, or approved read-only pragma. Results are capped at 500 rows.",
    tables: "Tables",
    tableHeading: (name: string, total: number | null) => `${name} · ${total ?? "…"} rows`,
    queryLabel: "SQL query",
    querySubmit: "Run read-only query",
    resultsHeading: "Query results",
    resultSuffix: "first 500 rows shown",
    noRows: "No rows returned.",
    nullDisplay: "NULL",
    listTablesFailed: "Unable to list tables.",
    loadTableFailed: "Unable to load table.",
    queryFailed: "Query failed.",
  },

  pagination: {
    previous: "Previous",
    next: "Next",
    page: (page: number) => `Page ${page}`,
  },

  /** Live API documentation, generated from the registered route schemas. */
  docs: {
    heading: "Live API documentation",
    explainer:
      "Generated from the registered Fastify route definitions and schemas at runtime.",
    loading: "Loading routes…",
    adminApi: "Admin API",
    familyApi: "Family API",
    routeSummary: (title: string, count: number) => `${title} · ${count} routes`,
    loadFailed: "Unable to load API documentation.",
  },

  dates: {
    never: "Never",
  },
};
