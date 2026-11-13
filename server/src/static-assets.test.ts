import { describe, it, expect } from "vitest";
import { cacheControlForPath } from "./static-assets";

/**
 * Cache headers for the built client. Vite emits content-hashed filenames
 * under /assets, so those can be immutable; the shell must always
 * revalidate or a stale index.html pins the app to an old bundle.
 */
describe("cacheControlForPath", () => {
  it("serves content-hashed /assets as immutable for a year, unix paths", () => {
    expect(cacheControlForPath("/srv/app/client/dist/assets/index-a1b2c3.js")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(cacheControlForPath("/srv/app/client/dist/assets/style-9f8e7d.css")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("serves content-hashed /assets as immutable for a year, windows paths", () => {
    expect(cacheControlForPath("C:\\app\\client\\dist\\assets\\index-a1b2c3.js")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("serves the shell with must-revalidate, never immutable", () => {
    expect(cacheControlForPath("/srv/app/client/dist/index.html")).toBe(
      "public, max-age=0, must-revalidate",
    );
    expect(cacheControlForPath("C:\\app\\client\\dist\\index.html")).toBe(
      "public, max-age=0, must-revalidate",
    );
  });

  it("serves stable root files (fonts, icons) with a day of cache", () => {
    expect(cacheControlForPath("/srv/app/client/dist/fonts/nunito-latin.woff2")).toBe(
      "public, max-age=86400",
    );
    expect(cacheControlForPath("/srv/app/client/dist/favicon.svg")).toBe(
      "public, max-age=86400",
    );
    expect(cacheControlForPath("/srv/app/client/dist/apple-touch-icon.png")).toBe(
      "public, max-age=86400",
    );
  });
});
