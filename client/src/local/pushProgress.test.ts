import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decidePush, serverStrictlyNewer } from "./pushProgress";
import {
  cacheLibraryPrivateState,
  cacheProgress,
  lockOfflineCache,
  readProgress,
  rememberProfileKey,
} from "./privateCache";
import { pushStaleProgress } from "./pushStaleProgress";
import { LocalLibraryDatabase } from "./db";
import type { BookProgress } from "../types";

vi.mock("../lib/request", () => ({
  request: vi.fn(async (path: string) => {
    if (path === "/api/audiobooks/500/progress") throw new Error("server exploded");
    return { position: 0, completed: false };
  }),
}));

import { request } from "../lib/request";

const SERVER = "https://a.example";
const mockedRequest = vi.mocked(request);

function progress(position: number, lastPlayed: string, completed = false): BookProgress {
  return { position, completed, lastPlayed };
}

let db: LocalLibraryDatabase;
let counter = 0;

beforeEach(async () => {
  lockOfflineCache();
  mockedRequest.mockClear();
  db = new LocalLibraryDatabase(`push-progress-${counter++}`);
  await rememberProfileKey(7, "correct-horse-9", db);
});

afterEach(async () => {
  lockOfflineCache();
  db.close();
});

describe("decidePush (spec 44 S1/S2)", () => {
  it("pushes when the cache is strictly newer than the server", () => {
    const cached = progress(100, "2026-11-16T10:00:00.000Z");
    const server = progress(50, "2026-11-16T09:00:00.000Z");
    expect(decidePush(cached, server)).toEqual({ push: true, position: 100, completed: false });
  });

  it("pushes when the server has no progress at all", () => {
    const cached = progress(100, "2026-11-16T10:00:00.000Z", true);
    expect(decidePush(cached, null)).toEqual({ push: true, position: 100, completed: true });
    expect(decidePush(cached, undefined)).toEqual({ push: true, position: 100, completed: true });
  });

  it("does not push when the server is newer or equal", () => {
    const cached = progress(100, "2026-11-16T09:00:00.000Z");
    expect(decidePush(cached, progress(50, "2026-11-16T10:00:00.000Z"))).toEqual({ push: false });
    expect(decidePush(cached, progress(50, "2026-11-16T09:00:00.000Z"))).toEqual({ push: false });
  });

  it("never pushes a cached row with an unparseable lastPlayed", () => {
    expect(decidePush(progress(100, "not a date"), null)).toEqual({ push: false });
  });

  it("pushes when the server value is unparseable (it cannot be trusted as newer)", () => {
    expect(decidePush(progress(100, "2026-11-16T10:00:00.000Z"), progress(50, "garbage"))).toEqual({
      push: true,
      position: 100,
      completed: false,
    });
  });

  it("never pushes with no cached row at all", () => {
    expect(decidePush(undefined, null)).toEqual({ push: false });
  });
});

describe("serverStrictlyNewer (spec 44 S2/S3)", () => {
  it("supersedes the cache only when the server is strictly newer", () => {
    const cached = progress(100, "2026-11-16T10:00:00.000Z");
    expect(serverStrictlyNewer(progress(50, "2026-11-16T11:00:00.000Z"), cached)).toBe(true);
    expect(serverStrictlyNewer(progress(50, "2026-11-16T10:00:00.000Z"), cached)).toBe(false);
    expect(serverStrictlyNewer(progress(50, "2026-11-16T09:00:00.000Z"), cached)).toBe(false);
  });

  it("supersedes a missing or garbage cached row", () => {
    expect(serverStrictlyNewer(progress(50, "2026-11-16T10:00:00.000Z"), undefined)).toBe(true);
    expect(serverStrictlyNewer(progress(50, "2026-11-16T10:00:00.000Z"), progress(0, "junk"))).toBe(true);
  });

  it("never supersedes when the server value is unparseable", () => {
    expect(serverStrictlyNewer(progress(50, "junk"), progress(100, "2026-11-16T10:00:00.000Z"))).toBe(false);
  });
});

describe("cacheLibraryPrivateState (spec 44 S3)", () => {
  it("keeps a cached row the server has no value for", async () => {
    await cacheProgress(42, progress(100, "2026-11-16T10:00:00.000Z"), SERVER, db);
    await cacheLibraryPrivateState([{ id: 42 }], SERVER, db);
    expect((await readProgress(42, SERVER, db))?.position).toBe(100);
  });

  it("overwrites the cache only when the server is strictly newer", async () => {
    await cacheProgress(42, progress(100, "2026-11-16T10:00:00.000Z"), SERVER, db);
    await cacheLibraryPrivateState(
      [{ id: 42, progress: progress(900, "2026-11-16T11:00:00.000Z") }],
      SERVER,
      db,
    );
    expect((await readProgress(42, SERVER, db))?.position).toBe(900);
  });

  it("keeps the cache when server and cache tie", async () => {
    await cacheProgress(42, progress(100, "2026-11-16T10:00:00.000Z"), SERVER, db);
    await cacheLibraryPrivateState(
      [{ id: 42, progress: progress(900, "2026-11-16T10:00:00.000Z") }],
      SERVER,
      db,
    );
    expect((await readProgress(42, SERVER, db))?.position).toBe(100);
  });
});

describe("pushStaleProgress (spec 44 S1/S5)", () => {
  it("pushes cached positions the server is missing or is older than", async () => {
    await cacheProgress(5, progress(100, "2026-11-16T10:00:00.000Z"), SERVER, db);
    await cacheProgress(6, progress(100, "2026-11-16T09:00:00.000Z"), SERVER, db);
    await cacheProgress(7, progress(100, "2026-11-16T10:00:00.000Z"), SERVER, db);

    const result = await pushStaleProgress(
      [
        { id: 5, progress: null }, // server has none → push
        { id: 6, progress: progress(50, "2026-11-16T10:30:00.000Z") }, // server newer → no push
        { id: 7, progress: progress(50, "2026-11-16T09:30:00.000Z") }, // cached newer → push
      ],
      SERVER,
      db,
    );

    expect(result.pushed.sort()).toEqual([5, 7]);
    expect(mockedRequest).toHaveBeenCalledWith(
      "/api/audiobooks/5/progress",
      expect.objectContaining({ method: "PUT", body: { position: 100, completed: false } }),
    );
    expect(mockedRequest).not.toHaveBeenCalledWith("/api/audiobooks/6/progress", expect.anything());
  });

  it("keeps the cache and retries later when the push fails", async () => {
    await cacheProgress(500, progress(100, "2026-11-16T10:00:00.000Z"), SERVER, db);
    const result = await pushStaleProgress([{ id: 500, progress: null }], SERVER, db);
    expect(result.pushed).toEqual([]);
    expect((await readProgress(500, SERVER, db))?.position).toBe(100);
  });
});
