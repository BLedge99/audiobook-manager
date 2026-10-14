import { describe, it, expect } from "vitest";
import { isSameDownload } from "./device";

/**
 * The progress listener used `progress.url !== url`, an exact comparison. The
 * plugin reports the URL it actually requested, which is not guaranteed to be
 * byte-identical, so the filter matched nothing: progress never fired and the
 * UI sat at "Downloading 0%" for the entire download. These tests pin the
 * looser matching so that cannot silently regress.
 */
describe("isSameDownload", () => {
  const url = "http://192.168.1.203:3000/api/tracks/42/stream?session=abc";

  it("matches an identical URL", () => {
    expect(isSameDownload(url, url)).toBe(true);
  });

  it("matches when the plugin normalised the scheme or host case", () => {
    expect(isSameDownload(`HTTP://192.168.1.203:3000/api/tracks/42/stream?session=abc`, url)).toBe(true);
  });

  it("matches when the plugin percent-encoded the query", () => {
    expect(isSameDownload("http://192.168.1.203:3000/api/tracks/42/stream?session=a%62c", url)).toBe(true);
  });

  it("does not match a different track", () => {
    expect(isSameDownload("http://192.168.1.203:3000/api/tracks/43/stream?session=abc", url)).toBe(false);
  });

  it("does not match a different book on the same host", () => {
    expect(isSameDownload("http://192.168.1.203:3000/api/audiobooks/9/stream?session=abc", url)).toBe(false);
  });

  it("treats a missing url as not ours", () => {
    expect(isSameDownload(undefined, url)).toBe(false);
  });
});