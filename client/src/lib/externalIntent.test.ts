/**
 * Spec 39 / ADR 034 — contract tests for the ExternalIntent bridge (Phase 3).
 *
 * These are the substitute for native unit tests: the Java plugin is kept
 * small enough to review line-by-line, and everything observable from JS is
 * pinned here. Native behaviour itself is verified on-device (spec 39's
 * manual matrix).
 */
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import {
  canResolve,
  launchIntent,
  launchStoreLink,
} from "./externalIntent";

/** Hoisted so the static mock can reference it — same pattern as the OAuth tests. */
const browserOpen = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@capacitor/browser", () => ({ Browser: { open: browserOpen } }));

const PLUGIN_KEY = "ExternalIntent";

function makePlugin(impl: Partial<{
  canResolve: (o: { url: string; package?: string }) => Promise<{ value: boolean }>;
  launchIntent: (o: { url: string; package?: string; chooserTitle?: string; requireApp?: boolean }) => Promise<{ completed: boolean }>;
}>) {
  return {
    canResolve: vi.fn(impl.canResolve ?? (async () => ({ value: false }))),
    launchIntent: vi.fn(impl.launchIntent ?? (async () => ({ completed: false }))),
  };
}

function setBridge(plugin: unknown) {
  (globalThis as Record<string, unknown>).Capacitor = plugin
    ? { Plugins: { [PLUGIN_KEY]: plugin } }
    : undefined;
}

function setNative(native: boolean) {
  const win = window as unknown as Record<string, unknown>;
  if (native) win.androidBridge = {};
  else delete win.androidBridge;
}

afterEach(() => {
  setBridge(undefined);
  setNative(false);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  browserOpen.mockClear();
});

describe("canResolve", () => {
  it("is false when the bridge is absent (browser/PWA)", async () => {
    setNative(false);
    await expect(canResolve("https://www.audible.com/pd/x/B00S2LTCQK")).resolves.toBe(false);
  });

  it("is false when the plugin is missing from the bridge", async () => {
    setNative(true);
    setBridge(undefined);
    await expect(canResolve("https://www.audible.com/pd/x/B00S2LTCQK")).resolves.toBe(false);
  });

  it("passes url and package through to the plugin", async () => {
    setNative(true);
    const plugin = makePlugin({ canResolve: async () => ({ value: true }) });
    setBridge(plugin);
    await expect(canResolve("https://www.audible.com/pd/x/B00S2LTCQK", "com.audible.application")).resolves.toBe(true);
    expect(plugin.canResolve).toHaveBeenCalledWith({
      url: "https://www.audible.com/pd/x/B00S2LTCQK",
      package: "com.audible.application",
    });
  });
});

describe("launchIntent", () => {
  it("returns true when the plugin completes", async () => {
    setNative(true);
    setBridge(makePlugin({ launchIntent: async () => ({ completed: true }) }));
    await expect(launchIntent({ url: "https://x", packageName: null })).resolves.toBe(true);
  });

  it("returns false when the plugin reports ActivityNotFoundException", async () => {
    setNative(true);
    setBridge(makePlugin({ launchIntent: async () => ({ completed: false }) }));
    await expect(launchIntent({ url: "https://x", packageName: null })).resolves.toBe(false);
  });

  it("returns false when the bridge is absent (native shell, plugin missing)", async () => {
    setNative(true);
    setBridge(undefined);
    await expect(launchIntent({ url: "https://x", packageName: null })).resolves.toBe(false);
  });

  it("browser fallback: window.open with noopener and noreferrer, no plugin call", async () => {
    setNative(false);
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const plugin = makePlugin({});
    setBridge(plugin);
    await expect(launchIntent({ url: "https://example.com/b", packageName: null })).resolves.toBe(true);
    expect(open).toHaveBeenCalledWith("https://example.com/b", "_blank", "noopener,noreferrer");
    expect(plugin.launchIntent).not.toHaveBeenCalled();
  });

  it("never writes the URL to the console", async () => {
    setNative(true);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    setBridge(makePlugin({ launchIntent: async () => ({ completed: true }) }));
    await launchIntent({ url: "https://secret.example/path?token=abc", packageName: null });
    for (const call of [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls].flat()) {
      expect(String(call)).not.toContain("secret.example");
    }
  });
});

describe("launchStoreLink ladder", () => {
  const URL = "https://www.audible.com/pd/x/B00S2LTCQK";
  const PKG = "com.audible.application";

  beforeEach(() => {
    setNative(true);
    browserOpen.mockClear();
  });

  it("requireApp success: implicit intent never runs, Custom Tab never opens", async () => {
    const plugin = makePlugin({ launchIntent: vi.fn(async () => ({ completed: true })) });
    setBridge(plugin);
    await expect(launchStoreLink(URL, { packageName: PKG })).resolves.toBe(true);
    expect(plugin.launchIntent).toHaveBeenCalledTimes(1);
    expect(plugin.launchIntent).toHaveBeenCalledWith(
      expect.objectContaining({ requireApp: true, package: PKG }),
    );
    expect(browserOpen).not.toHaveBeenCalled();
  });

  it("requireApp fails, implicit succeeds: Custom Tab never opens", async () => {
    const plugin = makePlugin({
      launchIntent: vi.fn(async (opts: { requireApp?: boolean }) => ({ completed: !opts.requireApp })),
    });
    setBridge(plugin);
    await expect(launchStoreLink(URL, { packageName: PKG })).resolves.toBe(true);
    expect(plugin.launchIntent).toHaveBeenCalledTimes(2);
    expect(browserOpen).not.toHaveBeenCalled();
  });

  it("both plugin launches fail: Custom Tab opens the URL", async () => {
    setBridge(makePlugin({}));
    await expect(launchStoreLink(URL, { packageName: PKG })).resolves.toBe(true);
    expect(browserOpen).toHaveBeenCalledWith({ url: URL });
  });

  it("browser (no native shell): window.open directly, plugin never consulted", async () => {
    setNative(false);
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const plugin = makePlugin({ launchIntent: vi.fn(async () => ({ completed: true })) });
    setBridge(plugin);
    await expect(launchStoreLink(URL, { packageName: PKG })).resolves.toBe(true);
    expect(open).toHaveBeenCalledWith(URL, "_blank", "noopener,noreferrer");
    expect(plugin.launchIntent).not.toHaveBeenCalled();
    expect(browserOpen).not.toHaveBeenCalled();
  });
});
