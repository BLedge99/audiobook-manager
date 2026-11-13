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
    kids: "Kids accounts",
    ratings: "Age ratings",
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

  /** Kids accounts: created and managed here, never in the family app. */
  kids: {
    heading: "Kids accounts",
    explainer:
      "Kids accounts see only age-appropriate books — shelves, search, Discover and downloads. Managed here, separate from household accounts.",
    createHeading: "Create a kids account",
    nameLabel: "Name",
    namePlaceholder: "Children of the household",
    bandLabel: "Age band",
    bandUnder6: "Under 6 (max age 5)",
    band69: "6-9 (max age 9)",
    band1013: "10-13 (max age 13)",
    band1417: "14-17 (max age 17)",
    passwordLabel: "Password",
    passwordHint: "At least 8 characters. The child signs in with this password on the account picker.",
    submitCreate: "Create kids account",
    listHeading: "Kids accounts",
    empty: "No kids accounts yet. Create one above.",
    loading: "Loading kids accounts…",
    loadFailed: "Unable to load kids accounts.",
    createFailed: "Unable to create the kids account.",
    updateFailed: "Unable to update the kids account.",
    deleteFailed: "Unable to delete the kids account.",
    fillShelf: "Add all age-appropriate books",
    fillShelfDoneOne: (count: number) => `Added ${count} book to the shelf.`,
    fillShelfDoneMany: (count: number) => `Added ${count} books to the shelf.`,
    fillShelfFailed: "Unable to add the age-appropriate books.",
    resetPassword: "Reset password",
    resetPasswordDone: "Password updated. Their sessions were revoked.",
    resetPasswordFailed: "Unable to reset the password.",
    shelfCount: (count: number) => `Books on the shelf: ${count}`,
    lastActive: (when: string) => `Last signed in: ${when}`,
    neverActive: "Last signed in: never",
    disabledLabel: "Disabled",
    activeLabel: "Active",
    disable: "Disable",
    enable: "Enable",
    deleteButton: "Delete",
    deleteConfirm: (name: string) =>
      `Delete ${name} and all of their listening history, favourites, wishlist and sessions? This cannot be undone.`,
    confirmPasswordPlaceholder: "New password",
    savePassword: "Save password",
  },

  /** Confirmed age ratings for books, provider suggestions, genre blocklist. */
  ratings: {
    heading: "Age ratings",
    explainer:
      "A confirmed rating always wins and is never changed by enrichment. Unrated books are visible to everyone; blocklisted genres hide from kids accounts.",
    searchLabel: "Search books",
    searchPlaceholder: "Title or author…",
    loading: "Loading books…",
    loadFailed: "Unable to load books.",
    empty: "No books match that search.",
    titleAuthor: (title: string, author: string) => `${title} — ${author}`,
    suggestionBadge: (age: number, source: string) => `Suggested ${age}+ by ${source}`,
    unrated: "Unrated",
    ladder: (age: number) => `${age}+`,
    clear: "Clear (unrated)",
    confirm: "Confirm",
    dismiss: "Dismiss",
    saveFailed: "Unable to save the rating.",
    blocklistHeading: "Genre blocklist",
    blocklistExplainer:
      "Blocked genres hide from every kids account, whatever their rating. Seeded once with Erotica, Horror and True Crime; add or remove any genre.",
    blocklistLoading: "Loading the blocklist…",
    blocklistFailed: "Unable to update the blocklist.",
    blockedListHeading: "Blocked genres",
    blockedEmpty: "No genres are blocked.",
    addHeading: "Add a genre",
    addSearchLabel: "Search genres to add",
    addSearchPlaceholder: "Name, e.g. True Crime…",
    addGenre: (name: string) => `Block ${name}`,
    removeGenre: (name: string) => `Unblock ${name}`,
    shelfCount: (count: number) => `${count} books`,
  },

  dates: {
    never: "Never",
  },
};
