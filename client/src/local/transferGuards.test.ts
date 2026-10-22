import { describe, it, expect } from "vitest";
import { describeTransferError, isDirectoryExists, isSameDownload, validateDownloadedSize } from "./device";

/**
 * These guard the bug that made downloads look successful while producing
 * nothing playable.
 *
 * The sequence that caused it: the app requested an authenticated endpoint, got
 * a 401 back, and the transfer still "succeeded" -- writing the ~29-byte JSON
 * error body to `books/<id>/<track>.mp3`. `putDownloadedTrack` then recorded the
 * track, so the UI reported the book as "On this device" while the file was
 * unplayable. Only discovered by going offline with no warning.
 *
 * Two independent checks close that off:
 *  - `validateDownloadedSize` refuses to record a short or empty file.
 *  - `describeTransferError` turns a plugin error code into something a human
 *    can act on, so an auth failure says so instead of failing opaquely.
 */
describe("validateDownloadedSize", () => {
  it("accepts a file whose size matches Content-Length", () => {
    expect(() => validateDownloadedSize(7_558_385, 7_558_385)).not.toThrow();
  });

  it("accepts an exact match of zero-length expectations", () => {
    expect(() => validateDownloadedSize(2048, 0)).not.toThrow();
  });

  it("rejects an empty file", () => {
    // The 401-body case can also produce nothing at all.
    expect(() => validateDownloadedSize(0, 0)).toThrow(/saved nothing/i);
  });

  it("rejects a truncated file", () => {
    expect(() => validateDownloadedSize(29, 7_558_385)).toThrow(/stopped partway/i);
  });

  it("tolerates a small mismatch, so a padded final chunk is not a failure", () => {
    // Within 1% or 1KB, whichever is larger.
    expect(() => validateDownloadedSize(7_560_000, 7_558_385)).not.toThrow();
  });

  it("does not reject a small file when the server reported no length", () => {
    expect(() => validateDownloadedSize(29, 0)).not.toThrow();
  });
});

describe("describeTransferError", () => {
  it("names an auth failure rather than failing opaquely", () => {
    const error = describeTransferError({ code: "OS-PLUG-FLTR-0010", data: { httpStatus: 401 } });
    expect(error.message).toMatch(/401/);
    expect(error.message).toMatch(/sign in/i);
  });

  it("reports any other HTTP status with its code", () => {
    const error = describeTransferError({ code: "OS-PLUG-FLTR-0010", data: { httpStatus: 404 } });
    expect(error.message).toMatch(/404/);
  });

  it("falls back to the plugin message when there is no HTTP status", () => {
    const error = describeTransferError({ code: "OS-PLUG-FLTR-0008", message: "The transfer was aborted." });
    expect(error.message).toBe("The transfer was aborted.");
  });

  it("turns a connection failure into something the listener can act on", () => {
    // The plugin says "failed to connect to server", and the household read it
    // as "the server is down" -- while the server was fine and the *phone*
    // could not reach it. Those have different fixes, so the message has to
    // name both.
    const error = describeTransferError({ code: "OS-PLUG-FLTR-0008", message: "Failed to connect to server." });
    expect(error.message).toMatch(/could not reach the server/i);
    expect(error.message).toMatch(/home network/i);
    expect(error.message).toMatch(/settings/i);
  });

  it("survives an error that is not an object", () => {
    expect(describeTransferError("boom")).toBeInstanceOf(Error);
  });
});

describe("isDirectoryExists", () => {
  // Regression: the migration called mkdir unconditionally, so every download
  // after the first for a book threw OS-PLUG-FILE-0010 and the download never
  // started. `recursive: true` still rejects a directory that already exists.
  it("treats an existing directory as success", () => {
    expect(isDirectoryExists({ code: "OS-PLUG-FILE-0010" })).toBe(true);
  });

  it("does not swallow a real mkdir failure", () => {
    expect(isDirectoryExists({ code: "OS-PLUG-FILE-0013" })).toBe(false);
    expect(isDirectoryExists(new Error("boom"))).toBe(false);
  });
});

describe("isSameDownload", () => {
  const url = "http://192.168.1.203:3000/api/tracks/42/stream?session=abc";

  it("matches the same URL", () => {
    expect(isSameDownload(url, url)).toBe(true);
  });

  it("tolerates the plugin normalising the URL", () => {
    expect(isSameDownload(`HTTP://192.168.1.203:3000/api/tracks/42/stream?session=a%62c`, url)).toBe(true);
  });

  it("separates concurrent downloads of different tracks", () => {
    expect(isSameDownload("http://192.168.1.203:3000/api/tracks/43/stream?session=abc", url)).toBe(false);
  });
});