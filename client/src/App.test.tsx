import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "./App";
import { copy } from "./copy";
import { probeServer } from "./lib/reachability";
import { fetchSession } from "./lib/api";
import type { Audiobook } from "./types";

/**
 * Spec 37, step 3.3 — the two shelf modes, at the App level.
 *
 * `mergeShelves` itself is unit-tested in `local/librarySource.test.ts`;
 * what nothing covered was the wiring: does the App actually show the
 * server shelf when the server answered, and the device shelf when it did
 * not? E2E cannot answer this offline (there is no offline E2E flow), so
 * the App gets rendered in jsdom with the seams mocked.
 *
 * The mocks are inline, following the AccountGate.test.tsx pattern: the
 * hooks are mocked at the module boundary; everything between (the gate,
 * the merge memo, the grid) is the real code.
 */

const SERVER_BOOK: Audiobook = {
  id: 1,
  title: "Server Title",
  author: "Server Author",
  fileFormat: "mp3",
  duration: 3600,
  tracks: [],
  contributors: [],
  genres: [],
  customTags: [],
} as unknown as Audiobook;

const DEVICE_BOOK: Audiobook = {
  ...SERVER_BOOK,
  id: 7,
  title: "Device Title",
} as unknown as Audiobook;

// What useDeviceLibrary returns for a device holding one book, and for an
// empty one. The mock ignores its argument (isNativeShell) on purpose: the
// merge and the gate get whatever this test hands them.
let deviceBooks: Audiobook[] = [{ ...DEVICE_BOOK, serverId: "https://a.example" } as Audiobook];

vi.mock("./lib/api", () => ({
  needsServerUrl: () => false,
  hasServerUrl: () => true,
  getServerUrl: () => "https://a.example",
  apiUrl: (path: string) => `https://a.example${path}`,
  onServerUnreachable: vi.fn(() => () => {}),
  setAccountExperience: vi.fn(),
  getActiveProfileId: vi.fn(() => "3"),
  getActiveProfileIdNumber: vi.fn(() => 3),
  setActiveProfileId: vi.fn(),
  setSessionToken: vi.fn(),
  lockLocal: vi.fn(),
  fetchAppConfig: vi.fn(async () => ({ accountExperience: "household", oauthProviders: [] })),
  fetchSession: vi.fn(),
}));

vi.mock("./lib/reachability", () => ({
  probeServer: vi.fn(),
}));

vi.mock("./useLibrary", () => ({
  useLibrary: () => ({
    books: [SERVER_BOOK],
    roots: [],
    loading: false,
    refreshing: false,
    error: null,
    refresh: vi.fn(async () => {}),
    refreshForProfile: vi.fn(async () => {}),
    serverLibrary: [],
    serverLibraryLoading: false,
    serverLibraryError: null,
    loadServerLibrary: vi.fn(),
    addToLibrary: vi.fn(),
    removeFromLibrary: vi.fn(),
    addRoot: vi.fn(),
    removeRoot: vi.fn(),
    scan: vi.fn(),
  }),
}));

vi.mock("./local/useDeviceLibrary", () => ({
  useDeviceLibrary: () => ({
    books: deviceBooks,
    rows: {},
    loading: false,
    error: null,
    unclaimed: [],
    recover: vi.fn(async () => ({ recovered: [], unreadable: [] })),
    usedBytes: 0,
    refresh: vi.fn(async () => {}),
    isDownloaded: () => false,
    progressOf: () => null,
    bytesFor: () => 0,
    download: vi.fn(),
    remove: vi.fn(),
    localUrlForTrack: () => "",
  }),
}));

vi.mock("./useBrowse", () => ({
  useBrowse: () => ({
    favourites: [],
    reviewQueue: [],
    genres: [],
    tags: [],
    enrichment: undefined,
    refresh: vi.fn(async () => {}),
    toggleFavourite: vi.fn(async () => {}),
  }),
  useDiscover: () => ({
    loadSimilar: vi.fn(),
    loadForMe: vi.fn(),
    result: undefined,
    wishlist: [],
    loading: false,
    loadingMore: false,
    error: null,
    loadMore: vi.fn(),
  }),
}));

vi.mock("./local/useExternalItems", () => ({
  useExternalItems: () => ({
    items: [],
    add: vi.fn(),
    remove: vi.fn(),
  }),
}));

vi.mock("./local/privateCache", () => ({
  activeCacheProfileId: vi.fn(() => null),
  hasProfileCache: vi.fn(async () => false),
  listCachedProfileIds: vi.fn(async () => []),
  offlineCacheState: vi.fn(() => "absent"),
}));

vi.mock("./local/CoverImage", () => ({
  clearCoverCache: vi.fn(async () => {}),
  coverCacheBytes: vi.fn(async () => 0),
  warmCoverCache: vi.fn(async () => {}),
  bookCoverKey: vi.fn(() => "cover-test"),
  CoverImage: () => null,
}));

vi.mock("./lib/biometricVault", () => ({
  biometricVault: {
    hasSavedValue: vi.fn(async () => false),
    unlock: vi.fn(),
    save: vi.fn(),
    clear: vi.fn(),
  },
}));

vi.mock("./lib/platform", () => ({
  isNativeShell: () => false,
}));

vi.mock("./components/ProfileSwitcher", () => ({
  ProfileSwitcher: () => null,
}));

beforeEach(() => {
  window.localStorage.clear();
  deviceBooks = [{ ...DEVICE_BOOK, serverId: "https://a.example" } as Audiobook];
  vi.mocked(probeServer).mockReset();
  vi.mocked(fetchSession).mockReset();
  vi.stubGlobal(
    "matchMedia",
    (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockReachableHousehold() {
  vi.mocked(probeServer).mockResolvedValue({ reachable: true, authed: true });
  vi.mocked(fetchSession).mockResolvedValue({
    authDisabled: false,
    profile: { id: 3, name: "Listener", color: "#89f" },
    role: "member",
    via: "profile",
    expiresAt: null,
    capabilities: { passkeys: false, devices: false },
  } as never);
}

describe("App — the two shelf modes", () => {
  it("shows the server shelf when the server is reachable", async () => {
    mockReachableHousehold();
    deviceBooks = [];
    render(<App />);
    expect(await screen.findByText("Server Title")).toBeInTheDocument();
  });

  it("shows the device shelf when the server is not reachable", async () => {
    vi.mocked(probeServer).mockResolvedValue({ reachable: false, authed: false });
    render(<App />);
    expect(await screen.findByText("Device Title")).toBeInTheDocument();
    expect(screen.queryByText("Server Title")).not.toBeInTheDocument();
  });

  it("offers the unlock screen offline when a locked cache is present", async () => {
    const { offlineCacheState } = await import("./local/privateCache");
    vi.mocked(offlineCacheState).mockReturnValue("present");
    vi.mocked(probeServer).mockResolvedValue({ reachable: false, authed: false });
    render(<App />);
    expect(await screen.findByText(copy.offline.unlockHeading)).toBeInTheDocument();
    expect(screen.queryByText("Device Title")).not.toBeInTheDocument();
  });
});
