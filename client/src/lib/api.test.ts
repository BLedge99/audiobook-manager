import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiUrl,
  boundedFetch,
  clearServerUrl,
  describeFailure,
  getServerUrl,
  isNetworkFailure,
  lockLocal,
  needsServerUrl,
  normaliseServerUrl,
  SERVER_URL_KEY,
  setServerUrl,
  setExplicitOfflineMode,
} from "./api";
import { lockOfflineCache } from "../local/privateCache";
import { TEST_SERVER_URL, TEST_SERVER_HOST } from "../test/constants";

vi.mock("../local/privateCache", () => ({ lockOfflineCache: vi.fn() }));

/** Simulate the Capacitor bridge, which App.tsx reads defensively. */
function setNativeShell(isNative: boolean) {
  (window as unknown as { Capacitor?: unknown }).Capacitor = isNative
    ? { isNativePlatform: () => true }
    : { isNativePlatform: () => false };
}

describe("normaliseServerUrl", () => {
  it("keeps a well-formed URL but drops the trailing slash", () => {
    expect(normaliseServerUrl(`${TEST_SERVER_URL}/`)).toBe(TEST_SERVER_URL);
  });

  it("supplies http:// when the user omits the scheme", () => {
    // The realistic phone typo. Rejecting it would be user-hostile for a
    // household tool where the address is typed by hand.
    expect(normaliseServerUrl(TEST_SERVER_HOST)).toBe(TEST_SERVER_URL);
  });

  it("trims surrounding whitespace", () => {
    expect(normaliseServerUrl("  http://home.local:3000  ")).toBe("http://home.local:3000");
  });

  it("preserves https rather than downgrading it", () => {
    expect(normaliseServerUrl("https://books.example.com")).toBe("https://books.example.com");
  });

  it("returns empty for blank input, meaning unconfigured", () => {
    expect(normaliseServerUrl("")).toBe("");
    expect(normaliseServerUrl("   ")).toBe("");
    expect(normaliseServerUrl(null)).toBe("");
    expect(normaliseServerUrl(undefined)).toBe("");
  });

  it("returns empty for input that cannot become a URL", () => {
    expect(normaliseServerUrl("http://")).toBe("");
    expect(normaliseServerUrl("::::")).toBe("");
  });
});

describe("apiUrl", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setNativeShell(false);
  });

  it("leaves paths relative when no server is configured", () => {
    // This is what keeps the browser, the dev server and every existing test
    // behaving exactly as they did before spec 26.
    expect(apiUrl("/api/audiobooks")).toBe("/api/audiobooks");
  });

  it("prefixes the configured server when there is one", () => {
    setServerUrl(TEST_SERVER_URL);
    expect(apiUrl("/api/audiobooks")).toBe(`${TEST_SERVER_URL}/api/audiobooks`);
  });

  it("adds the missing slash for a bare path", () => {
    setServerUrl(TEST_SERVER_URL);
    expect(apiUrl("api/audiobooks")).toBe(`${TEST_SERVER_URL}/api/audiobooks`);
  });

  it("round-trips through storage", () => {
    setServerUrl(`${TEST_SERVER_HOST}/`);
    expect(getServerUrl()).toBe(TEST_SERVER_URL);
    expect(window.localStorage.getItem(SERVER_URL_KEY)).toBe(TEST_SERVER_URL);
  });

  it("refuses to store an unusable URL", () => {
    expect(() => setServerUrl("http://")).toThrow(/server address/i);
  });

  it("clears back to relative URLs", () => {
    setServerUrl(TEST_SERVER_URL);
    clearServerUrl();
    expect(apiUrl("/api/audiobooks")).toBe("/api/audiobooks");
  });
});

describe("needsServerUrl", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("is true on Android with nothing configured", () => {
    setNativeShell(true);
    expect(needsServerUrl()).toBe(true);
  });

  it("is false on Android once a server is set", () => {
    setNativeShell(true);
    setServerUrl(TEST_SERVER_URL);
    expect(needsServerUrl()).toBe(false);
  });

  it("is false in a browser, which uses the dev-server proxy", () => {
    setNativeShell(false);
    expect(needsServerUrl()).toBe(false);
  });
});

describe("isNetworkFailure", () => {
  it("recognises the browser's own answer when the request never got one", () => {
    // This is the string the household was shown, more than once, while the
    // server was unreachable. It is a browser's internal phrase, not a
    // sentence anybody can act on.
    expect(isNetworkFailure(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("recognises the app's own deadline", () => {
    // A request to an unreachable host does not always fail, it hangs -- so
    // the timeout is the same problem wearing a different hat.
    const aborted = new DOMException("The user aborted a request.", "AbortError");
    expect(isNetworkFailure(aborted)).toBe(true);
  });

  it("leaves the server's own errors alone", () => {
    // The server answered, and said why. That message is the useful one.
    expect(isNetworkFailure(new Error("Invalid range"))).toBe(false);
    expect(isNetworkFailure(new Error("Could not remove the book."))).toBe(false);
  });

  it("is false for something that is not an error at all", () => {
    expect(isNetworkFailure(undefined)).toBe(false);
    expect(isNetworkFailure("Failed to fetch")).toBe(false);
  });
});

describe("describeFailure", () => {
  it("turns a network failure into a sentence with a next step", () => {
    expect(describeFailure(new TypeError("Failed to fetch"), "fallback")).toBe(
      "Could not reach the server. Check the phone is on the home network, and that the server address in Settings is right.",
    );
  });

  it("keeps the server's own message when the server answered", () => {
    expect(describeFailure(new Error("Invalid range"), "fallback")).toBe("Invalid range");
  });

  it("falls back when there is no message to use", () => {
    expect(describeFailure(undefined, "fallback")).toBe("fallback");
  });
});

describe("lockLocal", () => {
  beforeEach(() => {
    vi.mocked(lockOfflineCache).mockClear();
  });

  describe("explicit offline mode", () => {
    it("blocks API requests until reconnection is explicitly requested", async () => {
      const fetchMock = vi.fn(() => Promise.resolve(new Response("{}", { status: 200 })));
      const original = globalThis.fetch;
      globalThis.fetch = fetchMock as typeof fetch;
      setExplicitOfflineMode(true);
      try {
        await expect(boundedFetch("/api/auth/accounts")).rejects.toThrow("The app is in offline mode.");
        expect(fetchMock).not.toHaveBeenCalled();
        setExplicitOfflineMode(false);
        await expect(boundedFetch("/api/auth/accounts")).resolves.toBeInstanceOf(Response);
        expect(fetchMock).toHaveBeenCalledOnce();
      } finally {
        setExplicitOfflineMode(false);
        globalThis.fetch = original;
      }
    });
  });

  it("clears the local token and offline cache without calling the server", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response("{}", { status: 200 })));
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      await lockLocal();
    } finally {
      globalThis.fetch = original;
    }

    // The local lock is not a sign-out: it must not talk to the server at all.
    expect(fetchMock).not.toHaveBeenCalled();
    // The offline DEK is locked without revoking anything server-side.
    expect(lockOfflineCache).toHaveBeenCalled();
  });
});