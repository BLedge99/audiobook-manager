import { describe, it, expect, beforeEach } from "vitest";
import {
  ensureRecentServer,
  listRecentServers,
  RECENT_SERVERS_KEY,
  RECENT_SERVERS_MAX,
  recordRecentServer,
  removeRecentServer,
} from "./recentServers";

/**
 * Spec 40 — the recent-servers list: normalisation, de-duplication, the cap,
 * and the promise that malformed storage never breaks the panel.
 */

beforeEach(() => {
  window.localStorage.clear();
});

describe("listRecentServers", () => {
  it("returns an empty list when nothing is stored", () => {
    expect(listRecentServers()).toEqual([]);
  });

  it("returns an empty list when storage is not an array", () => {
    window.localStorage.setItem(RECENT_SERVERS_KEY, JSON.stringify({ url: "x" }));
    expect(listRecentServers()).toEqual([]);
  });

  it("returns an empty list when storage is not JSON", () => {
    window.localStorage.setItem(RECENT_SERVERS_KEY, "not json{{{");
    expect(listRecentServers()).toEqual([]);
  });

  it("drops entries that do not normalise and collapses duplicates", () => {
    window.localStorage.setItem(
      RECENT_SERVERS_KEY,
      JSON.stringify(["http://a.example:3000", "", "http://", "a.example:3000/", 42, null]),
    );
    expect(listRecentServers()).toEqual(["http://a.example:3000"]);
  });
});

describe("recordRecentServer", () => {
  it("normalises on the way in", () => {
    recordRecentServer("your-server:3000/");
    expect(listRecentServers()).toEqual(["http://your-server:3000"]);
  });

  it("moves a re-confirmed address to the front without duplicating it", () => {
    recordRecentServer("http://a.example:3000");
    recordRecentServer("http://b.example:3000");
    recordRecentServer("a.example:3000");
    expect(listRecentServers()).toEqual(["http://a.example:3000", "http://b.example:3000"]);
  });

  it("caps the list, dropping the oldest", () => {
    for (let i = 0; i < RECENT_SERVERS_MAX + 2; i += 1) {
      recordRecentServer(`http://server-${i}.example:3000`);
    }
    const list = listRecentServers();
    expect(list).toHaveLength(RECENT_SERVERS_MAX);
    expect(list[0]).toBe(`http://server-${RECENT_SERVERS_MAX + 1}.example:3000`);
    expect(list).not.toContain("http://server-0.example:3000");
    expect(list).not.toContain("http://server-1.example:3000");
  });

  it("ignores an address that cannot be normalised", () => {
    recordRecentServer("http://");
    expect(listRecentServers()).toEqual([]);
  });
});

describe("ensureRecentServer", () => {
  it("adds a missing address to the front", () => {
    recordRecentServer("http://a.example:3000");
    const list = ensureRecentServer("http://b.example:3000");
    expect(list).toEqual(["http://b.example:3000", "http://a.example:3000"]);
  });

  it("is idempotent — an address already listed does not duplicate or reorder", () => {
    recordRecentServer("http://a.example:3000");
    recordRecentServer("http://b.example:3000");
    const before = listRecentServers();
    const after = ensureRecentServer("http://a.example:3000");
    expect(after).toEqual(before);
  });

  it("does nothing for an empty or unusable address", () => {
    expect(ensureRecentServer("")).toEqual([]);
    expect(ensureRecentServer("http://")).toEqual([]);
  });
});

describe("removeRecentServer", () => {
  it("removes only the matching entry", () => {
    recordRecentServer("http://a.example:3000");
    recordRecentServer("http://b.example:3000");
    recordRecentServer("http://c.example:3000");
    expect(removeRecentServer("http://b.example:3000")).toEqual([
      "http://c.example:3000",
      "http://a.example:3000",
    ]);
  });

  it("removing something not listed leaves the list unchanged", () => {
    recordRecentServer("http://a.example:3000");
    expect(removeRecentServer("http://elsewhere.example:3000")).toEqual(["http://a.example:3000"]);
  });
});
