/**
 * Every user-facing string in the app.
 *
 * Spec 15b feature 7. The redesign introduced most of the interface copy in one
 * pass and it was never reviewed as a whole, so the same idea had three
 * different words depending on which file you were in. This file is the one
 * place that decides what the app says.
 *
 * ## Why a table and not a translation layer
 *
 * A localisation system would be the wrong tool here. The app is served to one
 * household, in one language, and what was actually wrong was not that strings
 * were scattered -- it was that nobody could read them all at once to judge
 * them. A single table makes the review possible, and it makes a wording
 * change a one-line edit instead of a component hunt.
 *
 * ## The voice
 *
 * **Warm, plain and brief.** Recorded in `PRODUCT.md`.
 *
 * - Plain means the listener never meets the filesystem. No paths, no formats,
 *   no "syncing" (product principle 1).
 * - Warm means the app is a friendly machine, not a corporate portal. But the
 *   warmth is in the *word choice*, never in a joke and never at the cost of
 *   saying what happened.
 * - Brief means the shortest wording that still carries meaning, consequence
 *   and recovery. `clarify`'s rule: an error says what failed, why when that
 *   is known, and how to recover.
 *
 * ## Rules this file holds to
 *
 * - **One noun, one verb, per concept.** "Favourite" is always "favourite"
 *   and never "like" or "starred". "Folder" is always "folder" and never
 *   "directory" or "library root" in front of a person.
 * - **Status colour never travels alone** (`DESIGN.md`). Every status word
 *   here pairs with a colour, never replaces one.
 * - **One ellipsis.** `…` (U+2026), never three dots. It was `…` in some
 *   files and `...` in others, which is invisible until two adjacent buttons
 *   disagree.
 * - **Complete, translatable sentences.** Interpolation is done with whole
 *   phrases and named parameters, so a translator can reorder them; no
 *   concatenated fragments.
 * - **No exclamation marks.** A confirmation is a fact, not an event.
 */

/* -------------------------------------------------------------------------- */
/* helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Count first, then the noun: "1 title", "12 titles".
 *
 * In one place so pluralisation is consistent everywhere, and so it can be
 * replaced wholesale if the app ever speaks another language. The irregular
 * cases take the plural form as an argument.
 *
 * **The naive `+ "s"` is a trap.** It turns "match" into "matchs", and the
 * only reason that was caught is that a test happened to assert the string. So
 * the irregular plural is passed explicitly, and `copy.test.ts` checks this
 * helper directly rather than relying on some component to render it.
 */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The verb that agrees with a count: "is" / "are", "has" / "have".
 *
 * English puts the verb after the noun, so the sentence reads
 * "3 books **are** part-finished" and "1 book **is** part-finished". Doing it
 * here means the agreement is written once rather than at every call site,
 * where it is exactly the kind of thing that gets one copy right and the other
 * copy wrong.
 */
export function verbFor(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/* -------------------------------------------------------------------------- */
/* brand                                                                       */
/* -------------------------------------------------------------------------- */

export const copy = {
  /**
   * The name is a placeholder. `PRODUCT.md` records the rename to Bookle as
   * unscheduled, and `e2e/helpers.ts` matches the heading by exact accessible
   * name -- so the rename is a two-line change once it is scheduled, and not
   * something to do inside a copy pass.
   */
  brand: {
    name: "Audiobook Manager",
    tagline: "local-first listening",
    footer: "Audiobook Manager · local-first listening",
  },

  /* ---------------------------------------------------------------------- */
  /* shared vocabulary                                                       */
  /* ---------------------------------------------------------------------- */

  /**
   * The status words, and only these. Every use of a status colour in the app
   * is paired with one of these, which is what stops colour from having to
   * speak for itself.
   */
  status: {
    done: "Finished",
    reading: "In progress",
    fresh: "Not started",
    changed: "Metadata updated",
  },

  theme: {
    light: "Switch to light theme",
    dark: "Switch to dark theme",
    auto: "Follow the device theme",
  },

  /** The one word for the shelf, used everywhere a shelf is offered. */
  shelf: "shelf",

  /**
   * Phrases that more than one surface uses.
   *
   * They live at the top level, not under a surface, because a phrase that
   * appears in three places is *one* phrase. Putting it in three groups would
   * mean three places to change and three chances to drift -- which is the
   * problem this file exists to solve, reproduced inside the fix.
   */
  narratedBy: (names: string) => `Narrated by ${names}`,
  narratedByCount: (count: number) => `Narrated by ${plural(count, "narrator")}`,
  unknownAuthor: "Unknown author",
  findMoreLikeThis: "Find more like this",
  /** The action on a candidate row. The same word in the review queue and in
   *  the book detail's metadata lookup. */
  use: "Use this",
  /**
   * The example home-server address.
   *
   * One entry, because it is shown twice -- on the first-run screen and as
   * the Settings field's placeholder -- and the two must not drift apart into
   * two different "example" addresses.
   */
  serverExample: "http://192.168.1.203:3000",
  /** The label for the server-address field, in both places it appears. */
  serverAddressLabel: "Server address",

  /* ---------------------------------------------------------------------- */
  /* shell: header, navigation, tabs                                         */
  /* ---------------------------------------------------------------------- */

  shell: {
    settings: "Settings",
    refresh: "Refresh library",
    refreshing: "Refreshing library",
    /** The short form, shown beside the spinning icon while a refresh runs. */
    refreshingShort: "Refreshing…",
    loadingLibrary: "Loading library…",
    /** Under the wordmark: "12 titles · 2 folders". */
    libraryCount: (titles: number, folders: number) =>
      folders ? `${plural(titles, "title")} · ${plural(folders, "folder")}` : plural(titles, "title"),
    offlineBanner: (books: number) =>
      `Offline — showing the ${plural(books, "book")} downloaded to this device.`,
  },

  tabs: {
    library: "Library",
    browse: "Browse",
    discover: "Discover",
    favourites: "Favourites",
    /** The nav's accessible name. One nav, two placements, one name. */
    sections: "Sections",
  },

  /* ---------------------------------------------------------------------- */
  /* library tab                                                             */
  /* ---------------------------------------------------------------------- */

  library: {
    heading: "All audiobooks",
    countInLibrary: (count: number) => `${plural(count, "title")} in your library`,
    countMatching: (count: number) => `${plural(count, "title")} matching your search`,
    empty: "Your library is empty. Add a folder and run a scan to discover audiobooks.",

    foldersHeading: "Library folders",
    foldersIntro: "Scan local folders to bring your audiobook metadata and artwork into one calm shelf.",
    scanLibrary: "Scan library",
    addFolder: "Add folder",
    folderPathLabel: "Library folder path",
    folderPathPlaceholder: "/data/audiobooks",
    folderLabelLabel: "Library folder label",
    folderLabelPlaceholder: "Label (optional)",
    noFolders: "No folders configured yet.",
    scanFolder: (name: string) => `Scan ${name}`,
    removeFolder: (name: string) => `Remove ${name}`,

    addFolderFailed: "Unable to add the folder.",
    scanFailed: "Unable to start the scan.",
    enrichment: (status: string, processed: number, queued: number, applied: number, review: number) =>
      `Enrichment ${status}: ${processed}/${queued} checked · ${applied} applied · ${review} need review`,
  },

  continueListening: {
    heading: "Continue listening",
    count: (count: number) => `${plural(count, "book")} ${verbFor(count, "is", "are")} part-finished`,
    /** Announced to a screen reader, and only to one. */
    more: (count: number) => `${plural(count, "more part-finished book")} scroll sideways.`,
  },

  card: {
    tracks: (count: number) => plural(count, "track"),
    findMoreLike: (title: string) => `Find more like ${title}`,
  },

  favourite: {
    add: "Add to favourites",
    remove: (title: string) => `Remove ${title} from favourites`,
    addNamed: (title: string) => `Add ${title} to favourites`,
    inYours: "In your favourites",
  },

  /* ---------------------------------------------------------------------- */
  /* browse tab                                                              */
  /* ---------------------------------------------------------------------- */

  browse: {
    heading: "Browse",
    intro: "Grouped by genre and series, using the metadata your library was enriched with.",
    filteredHeading: "Filtered results",
    seriesHeading: "Series",
    noGenreShelves:
      "No genre shelves yet. Enrichment assigns genres from the curated taxonomy — check the review queue for books still unmatched.",
    noShelves: "No shelves yet. Run a scan and enrichment to populate genres.",
  },

  filters: {
    heading: "Filter",
    clear: "Clear",
    clearCount: (count: number) => `Clear ${plural(count, "filter")}`,
    /** The accessible name of a chip group: "Filter by narrator". */
    groupLabel: (label: string) => `Filter by ${label.toLowerCase()}`,
    facets: {
      genre: "Genre",
      author: "Author",
      narrator: "Narrator",
      series: "Series",
      tag: "Tags",
    },
  },

  search: {
    /** The visible field label. */
    placeholder: "Search your library",
    /** The accessible name. It matches the placeholder so a screen reader and
     *  a sighted listener are told the same thing. */
    label: "Search the library",
    heading: "Search the library",
    clear: "Clear search",
    fields: "Fields:",
    examples: ["author: rowling", "genre: thriller", "narrator: fry", "tag: bedtime"],
    /** "2 matches for" — the irregular plural, given explicitly. */
    matches: (count: number) => `${plural(count, "match", "matches")} for`,
  },

  /* ---------------------------------------------------------------------- */
  /* discover tab                                                            */
  /* ---------------------------------------------------------------------- */

  discover: {
    heading: "Discover",
    intro: "Titles you do not own yet, matched on the genres of the books you favourite.",
    refresh: "Refresh",
    needsFavourites:
      "Favourite a few books and Discover will use them to suggest titles you do not own yet.",
    showMore: "Show 5 more",
    findingMore: "Finding more…",
    showing: (shown: number, total: number) => `Showing ${shown} of ${total}`,
    wishlistHeading: "Wishlist",
    wishlistEmpty: "Nothing saved yet. Save a suggestion above to keep track of it.",
    saveToWishlist: "Save to wishlist",
    onYourWishlist: "On your wishlist",
    removeFromWishlist: (title: string) => `Remove ${title} from wishlist`,
    markOwned: (title: string) => `Mark ${title} as owned`,
    owned: "Owned",
    markAsOwned: "Mark as owned",
    notInLibrary: "Not in your library yet",
    /**
     * The honesty rule from `LIMITATIONS.md` §1.8, and the single most
     * important sentence in this file. These are print records from a book
     * catalogue: no narrator, no runtime, not playable. The card must never
     * imply otherwise.
     */
    notAnAudiobook: "Book — not an audiobook yet",
    offline: "You're offline. Discover needs a connection to suggest new titles — your library still works.",
    notEnoughMetadata: "Not enough metadata yet.",
    noNewTitles: "No new titles found yet.",
  },

  /* ---------------------------------------------------------------------- */
  /* favourites tab                                                          */
  /* ---------------------------------------------------------------------- */

  favourites: {
    heading: "Favourites",
    empty: "Books you favourite are private to your profile and seed your Discover suggestions.",
    /** "3 books, for this profile only." */
    count: (count: number) => `${plural(count, "book")}, for this profile only.`,
  },

  /* ---------------------------------------------------------------------- */
  /* book detail                                                             */
  /* ---------------------------------------------------------------------- */

  detail: {
    close: "Close details",
    bookDetails: "Book details",

    metadataLookup: "Find metadata online",
    metadataLookingUp: "Looking up…",
    metadataFailed: "Metadata lookup failed. Try again later.",
    noMatches: "No matches found for this title.",
  },

  /* ---------------------------------------------------------------------- */
  /* tag suite (the "Book details" fold)                                     */
  /* ---------------------------------------------------------------------- */

  tagSuite: {
    heading: "Details",
    edit: "Edit",
    save: "Save",
    cancel: "Cancel",
    reset: "Reset",
    resetHelp: "Clear your overrides so enrichment and embedded tags can update these again",
    nothingChanged: "Nothing changed.",
    saved: "Saved. These values now win over anything the providers suggest.",
    saveFailed: "Could not save the details. Try again.",
    yours: "Yours",
    /** Where a value came from, when the provider did not say. */
    embedded: "embedded",
    fields: {
      title: "Title",
      author: "Author",
      publisher: "Publisher",
      year: "Year",
      series: "Series",
      seriesPosition: "Series number",
      language: "Language",
      subtitle: "Subtitle",
      description: "Description",
    },
    seriesPlaceholder: "e.g. The Expanse",
    seriesPositionPlaceholder: "e.g. 2 or 2.5",
    narrators: "Narrators",
    contributors: "Contributors",
    genres: "Genres",
    yourTags: "Your tags",
  },

  /* ---------------------------------------------------------------------- */
  /* review queue                                                            */
  /* ---------------------------------------------------------------------- */

  review: {
    heading: "Needs your review",
    intro: (count: number) =>
      `${plural(count, "book")} ${verbFor(count, "has", "have")} a possible match that was not confident enough to apply.`,
    checking: (title: string) => `Checking ${title}…`,
    keepWhatIHave: "Keep what I have",
    matchConfidence: "Match confidence",
    matchPercent: (percent: number) => `${percent}% match`,
    strongMatch: "Strong match",
    possibleMatch: "Possible match",
    weakMatch: "Weak match",
    currentlyShownAs: (title: string, author: string) => `Currently shown as “${title}” by ${author}.`,
    failed: "Something went wrong. Try again.",
    actionFailed: "Could not complete that. Try again.",
    loadFailed: "Could not load the matches. Try again.",
    series: (name: string) => `Series: ${name}`,
  },

  /* ---------------------------------------------------------------------- */
  /* tag manager                                                             */
  /* ---------------------------------------------------------------------- */

  tags: {
    heading: "Tags",
    intro: "Your own labels, shared across the household. Assign them to any book from its detail page.",
    newTagPlaceholder: "New tag, e.g. bedtime",
    newTagLabel: "New tag name",
    add: "Add",
    none: "No tags yet.",
    save: "Save",
    cancel: "Cancel",
    rename: "Rename",
    renameLabel: (name: string) => `Rename ${name}`,
    deleteLabel: (name: string) => `Delete ${name}`,
    mergeHeading: "Merge tags",
    mergeIntro: "Combine two tags into one. Every book carrying the source tag moves to the target.",
    mergeFrom: "Merge",
    mergeInto: "Into",
    chooseTag: "Choose a tag",
    mergeLabel: "Tag to merge",
    mergeIntoLabel: "Merge into tag",
    merge: "Merge",
    merged: (from: string, to: string, moved: number) =>
      `Merged ${from} into ${to} — ${plural(moved, "book")} moved.`,
    somethingWentWrong: "Something went wrong.",
  },

  /* ---------------------------------------------------------------------- */
  /* player                                                                  */
  /* ---------------------------------------------------------------------- */

  player: {
    region: "Audiobook player",
    /** The timeline's own accessible name. */
    progressRegion: "Audiobook progress",
    play: "Play",
    pause: "Pause",
    previousChapter: "Previous chapter",
    nextChapter: "Next chapter",
    backSeconds: (seconds: number) => `Back ${seconds} seconds`,
    forwardSeconds: (seconds: number) => `Forward ${seconds} seconds`,
    speed: "Playback speed",
    sleepTimer: "Sleep timer",
    sleepOff: "Off",
    sleepEndOfChapter: "End of chapter",
    sleepMinutes: (minutes: number) => `${minutes} min`,
    trackFallback: (number: number) => `Track ${number}`,
    needsProfile: "Select a profile to start listening — your position is saved per profile.",
    audioLoadFailed: "This audio file could not be loaded.",
    playbackCouldNotStart: "Playback could not start. Try again.",
    intoThis: (kind: "track" | "chapter") => `into this ${kind}`,
  },

  /* ---------------------------------------------------------------------- */
  /* download / device                                                       */
  /* ---------------------------------------------------------------------- */

  download: {
    download: "Download",
    resume: "Resume download",
    downloading: (percent: number) => `Downloading ${percent}%`,
    removeFromDevice: "Remove from device",
    onThisDevice: (bytes: string) => `On this device · ${bytes}`,
    progressLabel: (title: string) => `Download progress for ${title}`,
    removedWithErrors: (count: number) =>
      `Removed from the library, but ${plural(count, "file")} could not be deleted.`,
    removeFailed: "Could not remove the book.",
  },

  /* ---------------------------------------------------------------------- */
  /* gates                                                                   */
  /* ---------------------------------------------------------------------- */

  login: {
    heading: "Sign in",
    intro: "Enter the household password to continue.",
    passwordLabel: "Household password",
    passwordPlaceholder: "Household password",
    submit: "Sign in",
    checking: "Checking…",
    wrongPassword: "Incorrect password.",
    unreachable: "Could not reach the server.",
  },

  profile: {
    /** The straight apostrophe is load-bearing: `e2e/helpers.ts` matches this
     *  heading by exact accessible name. */
    heading: "Who's listening?",
    intro: "Pick your profile so your progress is saved separately from the rest of the household.",
    noneYet: "No profiles yet — create one below.",
    namePlaceholder: "Name",
    nameLabel: "New profile name",
    /**
     * The pattern across the app: a button that *opens* a form says what it
     * adds ("+ Add profile"), and the form's own button confirms it ("Add").
     * The two are never on screen at the same time, and the field beside the
     * confirm button is labelled, so "Add" is unambiguous there.
     */
    addProfile: "+ Add profile",
    addProfileCompact: "+ Profile",
    addShort: "Add",
    duplicate: "A profile with that name already exists.",
    loadFailed: (status: number) => `Could not load the profiles (HTTP ${status}). Try again in a moment.`,
    createFailed: (status: number) => `Could not create the profile (HTTP ${status}). Try again in a moment.`,
    createUnreachable: (detail: string) => `Could not create the profile. ${detail}`,
    sessionExpired: "Session expired. Reload the app to sign in again.",
    unreachable: (detail: string) => `Cannot reach the server. ${detail}`,
    checkAddress: "Check the server address in Settings.",
    switcherLabel: "Active profile",
    selectProfile: "Select profile",
    deleteActive: "Delete active profile",
  },

  serverSetup: {
    heading: "Connect to your library",
    intro: "Enter the address of the server at home. You only do this once.",
    /**
     * The example is separate so the address can be set in a `<code>` without
     * splitting a sentence into two fragments -- `clarify` asks for complete
     * translatable messages, and a sentence broken around a styled run is
     * exactly the kind of thing a translator cannot reorder.
     */
    exampleLead: "For example",
    addressPlaceholder: "192.168.1.203:3000",
    submit: "Connect",
    checking: "Checking…",
    enterAddress: "Enter a server address.",
    unreachable: (address: string, detail: string) =>
      `Could not reach ${address}. Check the address, and that the phone is on the home WiFi. (${detail})`,
    networkError: "network error",
  },

  offline: {
    heading: "Can't reach the server",
    withBooks: "Choose a profile to listen to the books already on this phone.",
    withoutBooks:
      "Nothing has been downloaded to this phone yet. Connect to the home WiFi, open the app and download a book — then it will play with no network at all.",
    tryAgain: "Try again",
    checking: "Checking…",
    connecting: "Connecting…",
  },

  /* ---------------------------------------------------------------------- */
  /* settings                                                                */
  /* ---------------------------------------------------------------------- */

  settings: {
    heading: "Home server",
    close: "Close",
    addressHelp:
      "On the home WiFi. If the router gives the server a new address, change it here — no reinstall needed.",
    saveAndTest: "Save and test",
    checking: "Checking…",
    connected: "Connected.",
    enterAddress: "Enter a server address.",
    unreachable: (address: string, detail: string) =>
      `Could not reach ${address}. Check the address and that the phone is on the home WiFi. (${detail})`,
    networkError: "network error",

    deviceHeading: "On this device",
    booksDownloaded: (count: number) => `${plural(count, "book")} downloaded`,
    serverUnreachable: "The server is unreachable. Downloaded books still play.",
    coversCached: (bytes: string) => `${bytes} of cover art cached, so covers still show with no connection.`,
    clearCovers: "Clear cached covers",
    coversCleared: "Cached covers cleared. They will come back as you browse.",
  },

  /* ---------------------------------------------------------------------- */
  /* errors that cross module boundaries                                     */
  /* ---------------------------------------------------------------------- */

  /**
   * Messages thrown from the API layer, the device bridge and the data hooks.
   *
   * They are here because they **reach the screen**: the download button
   * shows the thrown message verbatim, and the hooks' fallbacks are rendered
   * in a `Notice`. A message that is only ever logged can stay where it is;
   * one a person reads cannot.
   */
  errors: {
    loadLibrary: "Unable to load the library. Try again.",
    loadDiscover: "Unable to load Discover. Try again.",
    loadSimilar: "Unable to find similar books. Try again.",
    loadMore: "Unable to load more suggestions. Try again.",
    loadTags: "Unable to load the tags. Try again.",
    requestFailed: (status: number) =>
      `The server could not complete that request (HTTP ${status}). Try again.`,
    serverAddress: "Enter a server address, for example http://192.168.1.203:3000",

    bridgeNotReady: "The device bridge is not ready yet. Restart the app and try again.",
    filesystemUnavailable: "The Filesystem plugin is unavailable. Reinstall the app and try again.",
    fileTransferUnavailable: "The FileTransfer plugin is unavailable. Reinstall the app and try again.",
    downloadRejected: (status: number) =>
      `The server rejected the download (HTTP ${status}). Sign in again and retry.`,
    trackFailed: (status: number) => `The server returned HTTP ${status} for this track.`,
    downloadFailed: "The download failed.",
    downloadNoData: "The download finished but wrote no data. The server may have refused the request.",
    downloadIncomplete: (bytes: number, expected: number) =>
      `The download is incomplete (${bytes} of ${expected} bytes). Retry to finish it.`,
    noTracks: (title: string) => `"${title}" has no tracks to download.`,
    sizeUnreadable: (detail: string) => `Could not read the size of the downloaded file: ${detail}`,
  },

  /* ---------------------------------------------------------------------- */
  /* position and series: the maths modules speak too                       */
  /* ---------------------------------------------------------------------- */

  /**
   * The strings `lib/position.ts` produces.
   *
   * They live here because they are user-facing -- a listener reads "2h 14m
   * left" -- and because a wording change should be a one-line edit even when
   * the string is built deep inside a pure module. The module stays pure:
   * `copy.ts` has no dependencies of its own.
   */
  position: {
    chapterTitle: (index: number) => `Chapter ${index + 1}`,
    chapterNoun: "Chapter",
    trackNoun: "Track",
    /** The display number is passed in, already one-based. */
    heading: (noun: string, number: number) => `${noun} ${number}`,
    underAMinuteLeft: "under a minute left",
    minutesLeft: (minutes: number) => `${minutes}m left`,
    hoursMinutesLeft: (hours: number, minutes: number) => `${hours}h ${minutes}m left`,
    hoursLeft: (hours: number) => `${hours}h left`,
  },

  series: {
    /** "Book 2 of 5". */
    positionInSeries: (position: number, total: number) => `Book ${position} of ${total}`,
  },
} as const;

/* -------------------------------------------------------------------------- */
/* shared component defaults                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The labels the shared primitives own.
 *
 * They live here because they are user-facing strings like any other, and
 * because a primitive is the one place a string is invisible to anyone reading
 * a component -- `IconBtn` in particular has a `label` prop that is the
 * control's *only* accessible name.
 */
export const primitiveCopy = {
  /** The default accessible name for an icon button with no label. */
  iconButton: "Button",
  /** The default accessible name for the empty state. */
  emptyState: "Nothing here yet.",
} as const;

/* -------------------------------------------------------------------------- */
/* terminology glossary                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The one word per concept.
 *
 * `clarify` asks for a short glossary when inconsistency spans the product.
 * This is that list, and it is the thing to check before adding a new term.
 *
 * | Concept    | The word        | Never                        |
 * |------------|-----------------|------------------------------|
 * | a saved title the person likes | favourite | like, starred, bookmarked |
 * | a directory of audiobooks      | folder    | directory, path, root      |
 * | a suggestion from a catalogue  | title     | book, item, record         |
 * | a thing to download            | download  | sync, fetch, copy          |
 * | a person in the household      | profile   | user, account, member      |
 */
export const glossary = {
  favourite: "favourite",
  folder: "folder",
  title: "title",
  download: "download",
  profile: "profile",
} as const;
