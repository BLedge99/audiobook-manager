import { describe, expect, it, vi } from "vitest";
import { createMediaProxyUrl, nativeMediaProxyUrl } from "./nativeMediaProxy";

vi.mock("./platform", () => ({
  isNativeShell: () => false,
}));

vi.mock("./api", () => ({
  getServerUrl: () => "",
}));

describe("native media proxy URLs", () => {
  it("encodes the remote stream as a same-origin proxy target", () => {
    const target = "http://server/api/tracks/12/stream?media=token.value";
    const result = new URL(createMediaProxyUrl(target, "https://localhost"));

    expect(result.origin).toBe("https://localhost");
    expect(result.pathname).toBe("/__media_proxy");
    expect(result.searchParams.get("target")).toBe(target);
  });

  it("leaves browser playback URLs unchanged", async () => {
    const target = "http://server/api/tracks/12/stream";
    await expect(nativeMediaProxyUrl(target)).resolves.toBe(target);
  });
});
