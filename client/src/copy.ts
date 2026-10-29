/**
 * Every user-facing string in the app.
 *
 * Spec 15b feature 7. The redesign introduced most of the interface copy in one
 * pass and it was never reviewed as a whole, so the same idea had three
 * different words depending on which file you were in.
 *
 * ## The voice
 *
 * **Warm, plain and brief.** Recorded in `PRODUCT.md`.
 *
 * ## The rule that matters most: write for the listener
 *
 * The app has two audiences. There is the **listener** -- someone who wants to
 * find a book and press play -- and there is the **operator** -- whoever sets
 * up the server, scans folders and fixes metadata. They read different
 * screens, and they need different words.
 *
 * **A heading, an explanation or a hint must say why the listener is there
 * and what they can do, in their terms. It must not describe what the system
 * is doing.**
 *
 * The failure mode is a heading like *"Home server library — select books to
 * add to user library"*. It is a perfectly good comment to a developer and
 * useless to a person: it names the system's structure, and the person
 * already knows why they opened a screen called "All books".
 *
 * The same screen, said to the listener: **"Select books to add to your
 * library."**
 *
 * So this file is split in two:
 *
 * - **The top level is listener-facing.** Every string in it is something a
 *   listener reads on an everyday screen. `copy.test.ts` checks these for
 *   system jargon, and it fails the build when one appears.
 * - **`copy.operator` is operator-facing.** The server address, the scans, the
 *   metadata, the tags, the review queue. These screens are read by whoever
 *   maintains the household's server, and they may say "metadata" and
 *   "enrichment" because that is genuinely what those screens are about.
 *
 * A string that is read by both goes in the listener tier, and is written so
 * that it works for someone who does not know the word.
 *
 * ## Other rules this file holds to
 *
 * - **One word per concept, everywhere.** A saved title the person likes is a
 *   **favourite**, not a "like" or a "star".
 * - **Status colour never travels alone** (`DESIGN.md`). Every status colour is
 *   paired with a written label.
 * - **One ellipsis character:** `…`, never three dots.
 * - **No exclamation marks.** A confirmation is a fact, not an event.
 * - **Complete, translatable sentences.** Numbers and variables are passed as
 *   values, not spliced into fragments, so a translator can reorder them.
 * - **An error says what failed, why when that is known, and how to recover.**
 *   A status code is never the whole message.
 *
 * ## How this file is checked
 *
 * `scripts/check-copy.mjs` (vendored from the ui-copy skill) reads this file
 * against the `consumer-plain` profile, and `copy.operator` against
 * `professional-b2b`. `npm run check:copy` runs it; `scripts/copy.config.json`
 * records the product's own banned words and the keys still to be rewritten.
 * `copy.test.ts` checks the *mechanics* -- no empty strings, one ellipsis, no
 * exclamation marks, no repeated phrases, and the dynamic entries below.
 *
 * ## Messages with values: pending ICU
 *
 * An entry whose value is a function is a message with placeholders. Those are
 * written as template literals today, which reads fine in English but cannot be
 * reordered by a translator. They become ICU MessageFormat (or an equivalent)
 * when the app is internationalised. Until then `copy.test.ts` keeps an
 * explicit `ICU_PENDING` list of every such entry, so adding one is a
 * deliberate act and the list doubles as the migration checklist.
 */

/* -------------------------------------------------------------------------- */
/* helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Count first, then the noun: "1 book", "12 books".
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
/* listener-facing copy                                                        */
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
    tagline: "your books, at home",
    footer: "Audiobook Manager · your books, at home",
  },

  /**
   * The status words, and only these. Every use of a status colour in the app
   * is paired with one of these, which is what stops colour from having to
   * speak for itself.
   */
  status: {
    done: "Finished",
    reading: "In progress",
    fresh: "Not started",
    /**
     * The badge on a book whose details were changed and want a look.
     *
     * "Details updated", not "Metadata updated": this badge sits on the
     * listener's own bookshelf, and "metadata" is the system's word for it.
     */
    changed: "Details updated",
  },

  /**
   * The theme toggle's two labels.
   *
   * They name the **action**, not the state: in light mode the button says it
   * will switch to dark. The toggle has two states -- light and dark -- and
   * "follow the device" is the default it starts on rather than a third stop
   * on the cycle.
   */
  theme: {
    light: "Switch to light theme",
    dark: "Switch to dark theme",
  },

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
  /** Shared words that are not tied to one surface. */
  common: {
    cancel: "Cancel",
  },
  /** The action on a candidate row. The same word in the review queue and in
   *  the book detail's metadata lookup. */
  use: "Use this",

  tabs: {
    library: "Library",
    browse: "Browse",
    discover: "Discover",
    favourites: "Favourites",
    /**
     * Spec 27: the tab that lists everything the household has.
     *
     * "All books", not "Server": the listener is not looking for a server,
     * they are looking for more books to add.
     */
    serverLibrary: "All books",
    /** The nav's accessible name. One nav, two placements, one name. */
    sections: "Sections",
  },

  shell: {
    settings: "Settings",
    refresh: "Refresh library",
    refreshing: "Refreshing library",
    /** The short form, shown beside the spinning icon while a refresh runs. */
    refreshingShort: "Refreshing…",
    loadingLibrary: "Loading library…",
    /** Under the wordmark: "12 books · 2 folders". */
    libraryCount: (books: number, folders: number) =>
      folders ? `${plural(books, "book")} · ${plural(folders, "folder")}` : plural(books, "book"),
    offlineBanner: (books: number) =>
      `Offline — showing the ${plural(books, "book")} downloaded to this device.`,
    /**
     * Why it is offline.
     *
     * The banner alone is a symptom. The person sees "Offline" and has no way
     * to tell whether the server is down, the *phone* cannot reach it, or the
     * address in Settings is wrong — and those have three different fixes. The
     * most common one by far is the second.
     */
    offlineBannerHint:
      "The server could not be reached. Check the phone is on the home network, and that the server address in Settings is right.",
  },

  library: {
    /**
     * "Your audiobooks", not "All audiobooks".
     *
     * There are two shelves now -- the listener's and the household's -- and
     * "all" is exactly the word that used to mean the whole server.
     */
    heading: "Your audiobooks",
    countInLibrary: (count: number) => `${plural(count, "book")} in your library`,
    countMatching: (count: number) => `${plural(count, "book")} matching your search`,
    /**
     * Spec 27: an empty profile library has two possible causes -- the
     * household has no audiobooks yet, or this profile has not picked any --
     * and the message names both, because the next action differs.
     */
    empty:
      "Your library is empty. Choose books from All books, or check back once the household adds more.",
    chooseBooks: "Choose books",
    /** The Favourites tab is empty, but the library is not. */
    noFavourites: "No favourites yet. Tap the heart on a book to keep it here.",
    /** The Browse tab has no matches, but the library is not empty. */
    noMatches: "Nothing matches those filters. Try clearing one.",
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

  browse: {
    heading: "Browse",
    intro: "Grouped by genre and series, from the details your books already have.",
    filteredHeading: "Filtered results",
    seriesHeading: "Series",
    /**
     * "Shelves" is the app's own metaphor -- the visual world is a capsule
     * vending machine, and a vending machine has shelves -- so a listener who
     * sees one already knows what it means. What is *not* listener-facing is
     * the mechanism: "enrichment assigns genres from the curated taxonomy" is
     * a description of what the server does, not of what the person is looking
     * at.
     */
    noGenreShelves: "No genre shelves yet. Books get a genre once their details are filled in.",
    noShelves: "No shelves yet. They fill in as books are added.",
    /** The accessible names of the two arrow buttons on a shelf. */
    scrollLeft: (shelf: string) => `Scroll ${shelf} left`,
    scrollRight: (shelf: string) => `Scroll ${shelf} right`,
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

  discover: {
    heading: "Discover",
    /**
     * "Picked from the ones you favourite", not "matched on the genres of".
     * The listener wants to know the suggestions came from their own taste,
     * not how the matching works.
     */
    intro: "Books you do not have yet, picked from the ones you favourite.",
    refresh: "Refresh",
    needsFavourites: "Favourite a few books and Discover will suggest books you do not have yet.",
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
    offline: "You're offline. Discover needs a connection to suggest new books — your library still works.",
    notEnoughMetadata: "Not enough details about your books yet.",
    seedNeedsDetails: "This book needs a bit more detail before we can suggest similar books.",
    favouritesNeedDetail: "Your favourites need a bit more detail before we can suggest anything.",
    noNewBooks: "No new books found yet.",
    noSimilarBooks: "No similar books found yet.",
    /**
     * Why a suggestion was offered. The server sends the code and the value the
     * sentence needs, so these words live in the catalog like every other.
     */
    reason: {
      sharedGenre: (genre: string) => `Because it shares the genre ${genre}`,
      favouriteAuthor: (author: string) => `Because you like ${author}`,
      series: (series: string) => `Because it is in the ${series} series`,
      related: "Related to books you enjoy",
    },
  },

  favourites: {
    heading: "Favourites",
    /**
     * "They help Discover find books for you", not "seed your Discover
     * suggestions". "Seed" is what the system does; the listener wants to
     * know what their favourites are good for.
     */
    empty: "Favourites are private to your profile, and they help Discover find books for you.",
    /** "3 books, for this profile only." */
    count: (count: number) => `${plural(count, "book")}, for this profile only.`,
  },

  detail: {
    close: "Close details",
    bookDetails: "Book details",
  },

  /**
   * Spec 27: removing a book from the profile's library.
   *
   * The library part is recoverable -- the book stays on the server and the
   * "All books" tab can add it back -- so it is not worth a confirmation. The
   * *download* is not recoverable, so that is the one thing worth asking
   * about, and the question is only asked when there is a download to ask
   * about.
   */
  removeBook: {
    action: "Remove from my library",
    /** The short button label, where there is no room for the whole thing. */
    remove: "Remove",
    question: "Remove this book from your library?",
    alsoDelete: "It is downloaded to this device. Delete the download as well?",
    keepDownload: "Keep the download",
    deleteDownload: "Delete it",
    deleteFailed: "The book left your library, but the download could not be deleted.",
  },

  /**
   * Spec 27 — the tab that answers "what else is there to listen to?".
   *
   * The heading is the rule in action: not "Server library", which describes
   * the system's structure, but "Select books to add to your library", which
   * tells the listener what they are here to do.
   */
  serverLibrary: {
    heading: "Select books to add to your library",
    intro: "Every audiobook the household has. Add the ones you want.",
    loading: "Finding the books…",
    empty: "No audiobooks have been added yet. Books appear here once the household adds them.",
    allAudiobooks: "All audiobooks",
    /** "3 of 12 in your library" */
    heldCount: (held: number, total: number) => `${held} of ${total} in your library`,
    add: "Add",
    inYourLibrary: "In your library",

    /**
     * The tab, offline.
     *
     * The shelf belongs to the server, so offline there is nothing to add --
     * and the copy says so rather than pretending. What it also says is that
     * the tab is still useful: the books on this device are your library while
     * the server is out of reach, and they can still be taken away.
     */
    offlineHeading: "Books on this device",
    offlineIntro:
      "You're offline, so there's nothing new to add. You can still remove the ones you've downloaded.",
    offlineEmpty: "There are no books downloaded to this device.",
    onThisDevice: "On this device",
    /** "3 books" */
    offlineCount: (count: number) => plural(count, "book"),
  },

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

  login: {
    heading: "Sign in",
    intro: "Enter the household password to continue.",
    passwordLabel: "Household password",
    passwordPlaceholder: "Household password",
    submit: "Sign in",
    checking: "Checking…",
    wrongPassword: "That password doesn't match. Try again.",
    unreachable: "Could not reach the server.",
    locked: (seconds: number) =>
      `Too many tries. Wait ${seconds} ${seconds === 1 ? "second" : "seconds"} and try again.`,
    passwordTooShort: (minLength: number) => `Use at least ${minLength} characters.`,
    passwordTooLong: (maxLength: number) => `Use no more than ${maxLength} characters.`,
    passwordCommon: "Choose a password that isn't easy to guess.",
    passwordIsName: "Choose a password that isn't the profile's name.",
    profileUnclaimed: "This profile hasn't been set up yet. Ask the admin to set a password.",
    accountDisabled: "This profile is switched off. Ask the admin.",
    claimUnavailable: "This profile already has a password. Sign in instead.",
    passkeyUnavailable: "Passkeys aren't set up on this server. Use your password.",
    passkeyFailed: "Windows Hello didn't confirm. Try again, or use your password.",
    passkeyGone: "That passkey isn't saved any more. Use your password.",
    deviceGone: "That device isn't signed in any more. Use your password.",
    deviceFailed: "Fingerprint or face unlock didn't work. Use your password.",
    deviceUnavailable: "Biometric sensor is not available. Use your password.",
    deviceNotEnrolled: "No fingerprints or face data enrolled on this device. Enroll in Android Settings, then set up device unlock in app Settings.",
    deviceTransient: "Biometric sensor is not responding. Try again, or use your password.",
    /** The saved value can never be opened again (a new fingerprint invalidates it). */
    deviceNeedsSetup:
      "Device sign-in no longer works on this phone. Sign in with your password, then set it up again in Settings.",
    /** The saved value belongs to another profile on this phone. */
    deviceOtherProfile:
      "This phone's device sign-in belongs to a different profile. Sign in with your password.",
    deviceLocked:
      "Too many tries with fingerprint or face. Wait a moment, or sign in with your password.",
  },

  /**
   * The profile sign-in surface (spec 28). The heading is reused from
   * `copy.profile` so the account picker and the break-glass profile gate say
   * the same thing.
   */
  account: {
    intro: "Choose your profile, then enter its password.",
    passwordLabel: (name: string) => `${name}'s password`,
    passwordPlaceholder: "Profile password",
    setupHeading: (name: string) => `Set up ${name}`,
    setupIntro: "Use the household password once to choose a password for this profile.",
    newPasswordLabel: "New password",
    confirmPasswordLabel: "Confirm new password",
    setupSubmit: "Set up profile",
    mismatch: "The two passwords don't match.",
    needsSetup: "Needs setup",
    disabled: "Switched off",
    noProfiles: "No profiles yet. Use the household password to set one up.",
    loadFailed: (status: number) => `Could not load the profiles (HTTP ${status}).`,
    unclaimedHint: "This profile doesn't have a password yet.",
    useHousehold: "Use the household password",
    householdHeading: "Household password",
    householdIntro:
      "The household password is for setup and recovery. It does not sign you in as a profile.",
    back: "Choose another profile",
    lock: "Lock this profile",
  },

  /**
   * The passkey surface (spec 28, phase 6). Windows Hello is the only passkey
   * a household member will meet; the neutral word "passkey" covers the rest.
   */
  security: {
    heading: "Passkeys",
    intro: "Use Windows Hello instead of typing your password on this computer.",
    add: "Add Windows Hello",
    adding: "Waiting for Windows Hello…",
    empty: "No passkeys on this computer yet.",
    added: "Windows Hello is ready for this profile.",
    removed: "Passkey removed.",
    remove: "Remove",
    lastUsed: (when: string) => `Last used ${when}`,
    neverUsed: "Not used yet",
    signIn: "Sign in with Windows Hello",
    failed: "Windows Hello didn't finish. Try again, or use your password.",
    passwordHeading: "Password",
    passwordIntro: "Change the password you use to sign in to this profile. Other devices will need the new one.",
    currentPasswordLabel: "Current password",
    passwordChange: "Change password",
    passwordChanged: "Your password is changed.",
    passwordUnavailable: "Could not change the password. Check the connection and try again.",
    passwordCacheReset:
      "The saved data on this device was out of step with the new password, so it will be downloaded again the next time you open this profile.",
    deviceHeading: "Fingerprint or face",
    deviceIntro: "Use this device's screen lock to open your profile. The profile password still protects it on other devices.",
    deviceIntroOffline: "Use this device's screen lock to open your profile offline. This stores your profile key securely on this device.",
    deviceEnable: "Enable fingerprint or face",
    deviceEnableOffline: "Enable offline fingerprint or face",
    deviceReady: "Fingerprint or face unlock is ready on this device.",
    deviceRemoved: "Fingerprint or face unlock is turned off on this device.",
    deviceNeedsPassword: "Sign in with your profile password before enabling this.",
    deviceNeedsPasswordOffline: "Unlock your profile with your password before enabling this.",
    deviceSignIn: "Unlock with fingerprint or face",
    /**
     * Shown where the control would be, instead of hiding it. A missing button
     * teaches nobody why it is missing; "enrol a fingerprint" is the one thing
     * the listener can actually do about it.
     */
    deviceUnavailable: "Enrol a fingerprint in Android Settings to use device sign-in here.",
    thisDevice: "This device",
    vaultPromptTitle: "Open your profile",
    vaultPromptSubtitle: "Use your fingerprint or face to continue.",
    vaultPromptCancel: "Use password",
    sessionsHeading: "Signed-in devices",
    sessionsIntro: "Review where this profile is signed in, and sign out a device you no longer use.",
    otherDevice: "Another device",
    lastActive: (when: string) => `Last active ${when}`,
    signOutDevice: "Sign out",
    sessionRevoked: "That device has been signed out.",
    sessionsFailed: "Could not load signed-in devices. Try again in a moment.",
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
    /**
     * The status code is in parentheses, not in front: the listener needs to
     * know what to do next, and an operator can read the code in the logs.
     */
    loadFailed: (status: number) => `Could not load the profiles (HTTP ${status}). Try again in a moment.`,
    createFailed: (status: number) => `Could not create the profile (HTTP ${status}). Try again in a moment.`,
    createUnreachable: (detail: string) => `Could not create the profile. ${detail}`,
    sessionExpired: "You've been signed out. Reload the app to sign in again.",
    unreachable: (detail: string) => `Cannot reach the server. ${detail}`,
    checkAddress: "Check the server address in Settings.",
    switcherLabel: "Active profile",
    selectProfile: "Select profile",
    deleteActive: "Delete active profile",
  },

  offline: {
    heading: "Can't reach the server",
    withBooks:
      "These books are on this phone. Reconnect to the server to choose a profile for offline listening.",
    withoutBooks:
      "Nothing has been downloaded to this phone yet. Connect to the home WiFi, open the app and download a book — then it will play with no network at all.",
    /**
     * Spec 29. The replica threw, so the app does not know what is on the
     * device. Saying "nothing has been downloaded" here was a lie, and it is
     * the lie that made a phone full of audio look empty.
     */
    libraryReadFailed:
      "The app couldn't read its on-device library, so what is downloaded is unknown. The audio may still be here. Reconnect and try again.",
    /** The offline shelf when the device really does hold nothing. */
    emptyHeading: "No books downloaded",
    emptyIntro:
      "Books you download while the server is reachable play here with no network at all.",
    /**
     * Shown in the shell when the listener chose to listen without unlocking.
     * Deliberately not a prompt: asking again on every track would be nagging.
     */
    progressNotSaved:
      "Progress isn't being saved while this phone stays locked. Unlock it to keep your place.",
    /** The escape from the unlock screen for a listener who just wants to listen. */
    listenWithoutProgress: "Listen without progress",
    /**
     * Spec 29 recovery. Audio can outlive the database row that described it
     * (the WebView origin change did exactly that), so the app offers to adopt
     * it rather than pretending it was never downloaded.
     */
    unclaimed: (books: number) =>
      `Audio for ${plural(books, "book")} is already on this phone, but the app has lost track of which books they are.`,
    unclaimedOffline:
      "Reconnect to the server and they can be restored. The files will not be touched until then.",
    unclaimedAction: "Find them",
    unclaimedFinding: "Looking…",
    unclaimedRestored: (books: number) =>
      `Restored ${plural(books, "book")} from the audio already on this phone.`,
    unclaimedNothing: "Nothing could be restored. The audio is still on the phone.",
    recoverFailed: "Could not look for the books on this phone. Check the connection and try again.",
    tryAgain: "Try again",
    checking: "Checking…",
    connecting: "Connecting…",
    // Spec 28, phase 4. Offline is a password check against the local
    // encrypted cache, not against a server that cannot answer.
    unlockHeading: "Open your downloads",
    unlockIntro: "Enter your profile password to open the books on this device.",
    noCache:
      "This device has downloads but no protected profile data yet. Connect to the home WiFi and sign in once to set it up.",
    unlockFailed: "Could not open your saved profile data. Try again.",
    unlockIntroNoKey:
      "This phone holds no saved key for your profile. Sign in with your password, or use a different server address.",
  },

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

  /** A bare length, with no "left" -- e.g. a book's total runtime. */
  duration: {
    hoursMinutes: (hours: number, minutes: number) => `${hours}h ${minutes}m`,
    minutes: (minutes: number) => `${minutes}m`,
  },

  series: {
    /** "Book 2 of 5". */
    positionInSeries: (position: number, total: number) => `Book ${position} of ${total}`,
  },

  /**
   * Messages that reach the screen.
   *
   * They are here because the download button shows the thrown message
   * verbatim, and the hooks' fallbacks are rendered in a `Notice`. A message
   * that is only ever logged can stay in the operator tier; one a person reads
   * cannot.
   */
  errors: {
    loadLibrary: "Could not load the library. Try again.",
    loadAllBooks: "Could not read all the books from the server. Try again.",
    loadDiscover: "Could not load Discover. Try again.",
    loadSimilar: "Could not find similar books. Try again.",
    loadMore: "Could not load more suggestions. Try again.",
    loadTags: "Could not load the tags. Try again.",
    /** The status code is secondary, never the whole message. */
    requestFailed: (status: number) =>
      `The server did not answer as expected (HTTP ${status}). Try again in a moment.`,
    addToLibrary: "Could not add the book to your library. Try again.",
    removeFromLibrary: "Could not remove the book from your library. Try again.",
    bridgeNotReady: "The app isn't ready yet. Restart it and try again.",
    filesystemUnavailable: "The app can't save files on this phone. Reinstall it and try again.",
    fileTransferUnavailable: "Downloads aren't working. Reinstall the app and try again.",
    /**
     * The server could not be reached.
     *
     * The one message for every failed request, because the browser's own
     * answer -- "Failed to fetch" -- is a phrase nobody outside a browser
     * console has ever heard, and it says nothing about what to do.
     *
     * The two causes have different fixes and the person cannot tell them
     * apart: the server may be down, or the *phone* may not be able to reach
     * it. The second is by far the more common, and the address in Settings is
     * where it is fixed.
     */
    cannotReachServer:
      "Could not reach the server. Check the phone is on the home network, and that the server address in Settings is right.",
    downloadRejected: (status: number) =>
      `The server refused the download (HTTP ${status}). Sign in again to continue.`,
    trackFailed: (status: number) => `Could not load this track (HTTP ${status}). Try again.`,
    downloadFailed: "Could not download this book. Try again.",
    downloadNoData: "The download finished but saved nothing. The server may have refused it.",
    downloadIncomplete: (bytes: number, expected: number) =>
      `The download stopped partway (${bytes} of ${expected} bytes). Download it again.`,
    noTracks: (title: string) => `"${title}" has no tracks to download.`,
    sizeUnreadable: (detail: string) => `Could not read the size of the downloaded file: ${detail}`,
  },

  /**
   * The sentence for each stable API error code that a **listener** can meet
   * (ADR 015).
   *
   * The server sends a code plus the values the sentence needs (`params`), and
   * the words live here. This map is deliberately short: a sentence that
   * cannot say what failed and how to recover better than the generic
   * `copy.errors.requestFailed` does not earn an entry. A code that names
   * folders, scans or tags belongs to `copy.operator.apiErrors`, because those
   * are screens the operator reads, and this tier must not use those words.
   *
   * Two codes reuse an entry that already exists -- the password line and the
   * duplicate-profile line -- through the aliases in `lib/apiError.ts`, so
   * those sentences still have exactly one home.
   *
   * `request_invalid` is deliberately absent. It replaced the echoed framework
   * message on a 4xx, and a generic sentence with a way out beats
   * `body/name must be string`.
   */
  apiErrors: {
    profileRequired: "Choose a profile first.",
    profileNameRequired: "Enter a name.",
    audiobookNotFound: "That book isn't in the library any more.",
    coverNotFound: "That cover isn't available.",
    forbidden: "You don't have access to that book.",
    audioFileNotFound: "This book's audio can't be found.",
    trackNotFound: "That chapter can't be found.",
    wishlistItemNotFound: "That book isn't on your wishlist any more.",
  },

  /* ---------------------------------------------------------------------- */
  /* operator-facing copy                                                    */
  /* ---------------------------------------------------------------------- */

  /**
   * The screens the person who maintains the household's server reads.
   *
   * These may say "metadata", "enrichment" and "scan", because that is
   * genuinely what those screens are about -- the operator is the one person
   * who needs those words. The listener tier above is where the rule is
   * enforced.
   */
  operator: {
    /**
     * The example home-server address.
     *
     * One entry, because it is shown twice -- on the first-run screen and as
     * the Settings field's placeholder -- and the two must not drift apart
     * into two different "example" addresses.
     */
    serverExample: "http://192.168.1.203:3000",
    /** The label for the server-address field, in both places it appears. */
    serverAddressLabel: "Server address",
    /**
     * A failed health check's status, shown as the detail of the "could not
     * reach" sentence in Settings and ServerSetup. One entry, because both
     * screens answer the same question the same way.
     */
    serverReplied: (status: number) => `HTTP ${status} from the server.`,

    libraryFolders: {
      heading: "Library folders",
      intro: "Add a folder of audiobooks and the library fills in with the details and cover art.",
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
    },

    enrichment: {
      notice: (status: string, processed: number, queued: number, applied: number, review: number) =>
        `Enrichment ${status}: ${processed}/${queued} checked · ${applied} applied · ${review} need review`,
    },

    metadata: {
      lookup: "Find metadata online",
      lookingUp: "Looking up…",
      failed: "Metadata lookup failed. Try again later.",
      noMatches: "No matches found for this title.",
    },

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
      failed: "That decision wasn't saved. Try again.",
      actionFailed: "Could not complete that. Try again.",
      loadFailed: "Could not load the matches. Try again.",
      series: (name: string) => `Series: ${name}`,
    },

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
      somethingWentWrong: "That change wasn't saved. Try again.",
    },

    settings: {
      heading: "Home server",
      close: "Close",
      addressHelp:
        "On the home WiFi. If the router gives the server a new address, change it here — no reinstall needed.",
      saveAndTest: "Save and test",
      checking: "Checking…",
      connected: "Connected.",
      enterAddress: "Enter a server address.",
      networkError: "network error",
      unreachable: (address: string, detail: string) =>
        `Could not reach ${address}. Check the address and that the phone is on the home WiFi. (${detail})`,
      deviceHeading: "On this device",
      /** Which build is installed. Every APK says 1.0, so this is the only way to tell. */
      build: "Build",
      booksDownloaded: (count: number) => `${plural(count, "book")} downloaded`,
      serverUnreachable: "The server is unreachable. Downloaded books still play.",
      coversCached: (bytes: string) => `${bytes} of cover art cached, so covers still show with no connection.`,
      clearCovers: "Clear cached covers",
      coversCleared: "Cached covers cleared. They will come back as you browse.",
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
      addressLabel: "Server address",
      addressPlaceholder: "192.168.1.203:3000",
      submit: "Connect",
      changeAddress: "Change server address",
      continueOffline: "Continue offline",
      checking: "Checking…",
      enterAddress: "Enter a server address.",
      networkError: "network error",
      unreachable: (address: string, detail: string) =>
        `Could not reach ${address}. Check the address, and that the phone is on the home WiFi. (${detail})`,
    },

    /**
     * API errors only an operator screen can raise: adding a folder, scanning,
     * editing genres and tags, and the review queue.
     *
     * They live here, not in `copy.apiErrors`, because they name folders,
     * scans and tags -- the words the listener tier must not use.
     * `lib/apiError.ts` checks the listener map first, then this one, so a code
     * is written once, for the audience that can actually meet it.
     *
     * `tagNameRejected` and `tagMergeFailed` are keyed by the reason the server
     * sends (`too-long`, `same-tag`, ...). The `...Fallback` entries cover a
     * reason this client does not know, so an older client still says
     * something useful against a newer server instead of showing a raw code.
     */
    apiErrors: {
      libraryPathRequired: "Enter a folder path.",
      libraryPathInaccessible: "That folder can't be read. Check the path and try again.",
      libraryRootRequired: "Add a folder before starting a scan.",
      candidateNotFound: "That match is no longer available.",
      genreSlugTaken: "A genre with that name already exists.",
      parentGenreNotFound: "That parent genre no longer exists.",
      genreNotFound: "That genre no longer exists.",
      catchAllGenreUndeletable: "The catch-all genre can't be deleted.",
      unknownGenreId: "One of those genres no longer exists.",
      unknownTagId: "One of those tags no longer exists.",
      tagNotFound: "That tag no longer exists.",
      tagNameRejected: {
        empty: "Enter a tag name.",
        tooLong: "That tag name is too long.",
        reserved: "That name is used by the app. Choose another.",
        collidesWithGenre: "A genre already uses that name.",
        invalidCharacters: "That tag name can't contain < > { } [ ] \\ or /.",
      },
      tagNameRejectedFallback: "That tag name can't be used. Choose another.",
      tagMergeFailed: {
        notFound: "Could not find one of those tags. Refresh and try again.",
        sameTag: "Choose two different tags.",
      },
      tagMergeFailedFallback: "Could not merge those tags. Try again.",
    },
  },
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
 * The `{ term, avoid }` shape is not decoration: `scripts/check-copy.mjs`
 * reads it and warns when a string uses an `avoid` word, so the glossary is
 * enforced rather than merely documented. `avoid` stays conservative -- it
 * lists the plain synonyms that are always wrong, not every word that could be
 * misread. ("like" is absent on purpose: "find more like this" is a comparison,
 * not a synonym for a favourite.)
 *
 * | Concept                        | The word  | Never (machine-checked)   |
 * |--------------------------------|-----------|---------------------------|
 * | a saved book the person likes  | favourite | star, bookmark            |
 * | a directory of audiobooks      | folder    | directory, root           |
 * | a book, in any state           | book      | item, record, volume      |
 * | a thing pulled to the device   | download  | sync, fetch               |
 * | a person in the household      | profile   | user, account, member     |
 */
export const glossary = {
  favourite: { term: "favourite", avoid: ["star", "bookmark"] },
  folder: { term: "folder", avoid: ["directory", "root"] },
  book: { term: "book", avoid: ["item", "record", "volume"] },
  download: { term: "download", avoid: ["sync", "fetch"] },
  profile: { term: "profile", avoid: ["user", "account", "member"] },
} as const;
