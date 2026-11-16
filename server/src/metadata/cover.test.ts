import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isPublicCoverUrl, fetchCover, coverFilename, MAX_COVER_BYTES } from "./cover";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF", "latin1"),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from("WEBP", "latin1"),
  Buffer.from("VP8 ", "latin1"),
  Buffer.from([0x00, 0x00]),
]);

const tmpDirs: string[] = [];
function tempCoverDir(name: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `cover-test-${name}-`));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.unstubAllGlobals();
  while (tmpDirs.length) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

/** A mocked fetch Response whose body streams the given chunks. */
function streamResponse(
  chunks: Buffer[],
  init: { status?: number; contentType?: string | null } = {},
): Response {
  const status = init.status ?? 200;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk));
      controller.close();
    },
  });
  const headers = new Headers();
  if (init.contentType !== null) {
    headers.set("content-type", init.contentType ?? "image/jpeg");
  }
  return new Response(body, { status, headers });
}

function redirectResponse(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

const PUBLIC_LOOKUP = async () => [{ address: "93.184.216.34", family: 4 }];
const PRIVATE_LOOKUP = async () => [{ address: "127.0.0.1", family: 4 }];

function stubFetchSequence(steps: Array<Response | (() => Response)>) {
  let call = 0;
  const mock = vi.fn(async () => {
    const step = steps[Math.min(call, steps.length - 1)];
    call += 1;
    return typeof step === "function" ? step() : step;
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("isPublicCoverUrl (SSRF guard)", () => {
  it("accepts ordinary https provider CDNs", () => {
    expect(isPublicCoverUrl("https://covers.openlibrary.org/b/id/1-M.jpg")).toBe(true);
    expect(isPublicCoverUrl("https://cdn.audnex.us/books/A1.jpg")).toBe(true);
  });

  it("rejects non-http schemes", () => {
    expect(isPublicCoverUrl("file:///etc/passwd")).toBe(false);
    expect(isPublicCoverUrl("gopher://example.com")).toBe(false);
  });

  it("rejects localhost, .local names and trailing-dot variants", () => {
    expect(isPublicCoverUrl("http://localhost/cover.jpg")).toBe(false);
    expect(isPublicCoverUrl("http://nas.local/cover.jpg")).toBe(false);
    expect(isPublicCoverUrl("http://localhost./cover.jpg")).toBe(false);
    expect(isPublicCoverUrl("http://printer.local./cover.jpg")).toBe(false);
  });

  it("rejects private, loopback and link-local IPv4", () => {
    expect(isPublicCoverUrl("http://127.0.0.1/cover.jpg")).toBe(false);
    expect(isPublicCoverUrl("http://10.1.2.3/cover.jpg")).toBe(false);
    expect(isPublicCoverUrl("http://192.168.1.10/cover.jpg")).toBe(false);
    expect(isPublicCoverUrl("http://172.16.5.5/cover.jpg")).toBe(false);
    expect(isPublicCoverUrl("http://172.31.255.255/cover.jpg")).toBe(false);
    expect(isPublicCoverUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isPublicCoverUrl("http://0.0.0.0/cover.jpg")).toBe(false);
  });

  it("rejects CGNAT and other non-global IPv4 ranges", () => {
    expect(isPublicCoverUrl("http://100.64.0.1/cover.jpg")).toBe(false);
    expect(isPublicCoverUrl("http://100.127.255.254/cover.jpg")).toBe(false);
  });

  it("rejects non-canonical IPv4 spellings (whatwg normalises them to dotted quad)", () => {
    // The WHATWG URL parser normalises these to 127.0.0.1; the guard must reject too.
    expect(isPublicCoverUrl("http://2130706433/cover.jpg")).toBe(false);
    expect(isPublicCoverUrl("http://0x7f000001/cover.jpg")).toBe(false);
    expect(isPublicCoverUrl("http://017700000001/cover.jpg")).toBe(false);
    expect(isPublicCoverUrl("http://127.1/cover.jpg")).toBe(false);
    expect(isPublicCoverUrl("http://0177.1/cover.jpg")).toBe(false);
  });

  it("rejects IPv6 loopback, unspecified, link-local, ULA and multicast", () => {
    expect(isPublicCoverUrl("http://[::1]/cover.jpg")).toBe(false);
    expect(isPublicCoverUrl("http://[::]/cover.jpg")).toBe(false);
    expect(isPublicCoverUrl("http://[fe80::1]/cover.jpg")).toBe(false);
    expect(isPublicCoverUrl("http://[fc00::1]/cover.jpg")).toBe(false);
    expect(isPublicCoverUrl("http://[fd00::abcd]/cover.jpg")).toBe(false);
    expect(isPublicCoverUrl("http://[ff02::1]/cover.jpg")).toBe(false);
  });

  it("rejects IPv4-mapped IPv6 loopback addresses", () => {
    expect(isPublicCoverUrl("http://[::ffff:127.0.0.1]/cover.jpg")).toBe(false);
    expect(isPublicCoverUrl("http://[::ffff:10.0.0.5]/cover.jpg")).toBe(false);
    expect(isPublicCoverUrl("http://[::ffff:169.254.169.254]/")).toBe(false);
  });

  it("rejects garbage", () => {
    expect(isPublicCoverUrl("not a url")).toBe(false);
    expect(isPublicCoverUrl("")).toBe(false);
  });
});

describe("fetchCover", () => {
  it("downloads a valid jpeg cover", async () => {
    stubFetchSequence([streamResponse([JPEG])]);
    const result = await fetchCover("https://covers.example.com/a.jpg", "x_1.jpg", {
      dir: tempCoverDir("ok"),
      lookup: PUBLIC_LOOKUP,
    });
    expect(result.ok).toBe(true);
    expect(result.path).toBeDefined();
  });

  it("rejects when DNS answers with a private address, without connecting", async () => {
    const mock = stubFetchSequence([streamResponse([JPEG])]);
    const result = await fetchCover("https://covers.example.com/a.jpg", "x_1.jpg", {
      dir: tempCoverDir("dns-private"),
      lookup: PRIVATE_LOOKUP,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/^dns-/);
    expect(mock).not.toHaveBeenCalled();
  });

  it("follows a redirect to a public host", async () => {
    stubFetchSequence([
      redirectResponse("https://cdn.example.com/final.jpg"),
      streamResponse([JPEG], { contentType: "image/jpeg" }),
    ]);
    const result = await fetchCover("https://covers.example.com/a.jpg", "x_1.jpg", {
      dir: tempCoverDir("redirect-ok"),
      lookup: PUBLIC_LOOKUP,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a redirect to a loopback address (SSRF via 302)", async () => {
    stubFetchSequence([
      redirectResponse("http://127.0.0.1:3000/api/health"),
      streamResponse([JPEG]),
    ]);
    const result = await fetchCover("https://covers.example.com/a.jpg", "x_1.jpg", {
      dir: tempCoverDir("redirect-loopback"),
      lookup: PUBLIC_LOOKUP,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/redirect|untrusted/);
  });

  it("rejects a redirect to the cloud metadata service", async () => {
    stubFetchSequence([
      redirectResponse("http://169.254.169.254/latest/meta-data"),
      streamResponse([JPEG]),
    ]);
    const result = await fetchCover("https://covers.example.com/a.jpg", "x_1.jpg", {
      dir: tempCoverDir("redirect-metadata"),
      lookup: PUBLIC_LOOKUP,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a redirect to a host that resolves privately", async () => {
    stubFetchSequence([
      redirectResponse("https://internal.example.com/secret.jpg"),
      streamResponse([JPEG]),
    ]);
    const lookups: string[] = [];
    const lookup = async (host: string) => {
      lookups.push(host);
      return host === "internal.example.com"
        ? [{ address: "10.0.0.9", family: 4 }]
        : [{ address: "93.184.216.34", family: 4 }];
    };
    const result = await fetchCover("https://covers.example.com/a.jpg", "x_1.jpg", {
      dir: tempCoverDir("redirect-dns"),
      lookup,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/^dns-/);
    expect(lookups).toContain("internal.example.com");
  });

  it("rejects after too many redirects", async () => {
    stubFetchSequence([
      redirectResponse("https://covers.example.com/1"),
      redirectResponse("https://covers.example.com/2"),
      redirectResponse("https://covers.example.com/3"),
      redirectResponse("https://covers.example.com/4"),
      redirectResponse("https://covers.example.com/5"),
      redirectResponse("https://covers.example.com/6"),
    ]);
    const result = await fetchCover("https://covers.example.com/a.jpg", "x_1.jpg", {
      dir: tempCoverDir("redirects"),
      lookup: PUBLIC_LOOKUP,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/redirect/);
  });

  it("rejects when the streamed body exceeds maxBytes", async () => {
    const big = Buffer.alloc(64 * 1024, 0x41);
    stubFetchSequence([streamResponse([big, big, big, big])]);
    const result = await fetchCover("https://covers.example.com/a.jpg", "x_1.jpg", {
      dir: tempCoverDir("big"),
      maxBytes: 100 * 1024,
      lookup: PUBLIC_LOOKUP,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("too-large");
  });

  it("rejects a disallowed content-type", async () => {
    stubFetchSequence([streamResponse([PNG], { contentType: "text/html" })]);
    const result = await fetchCover("https://covers.example.com/a.jpg", "x_1.jpg", {
      dir: tempCoverDir("html"),
      lookup: PUBLIC_LOOKUP,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unsupported-content-type-text/html");
  });

  it("rejects bytes that are not an image even with an image content-type", async () => {
    stubFetchSequence([
      streamResponse([Buffer.from("<html><body>not a cover</body></html>", "latin1")], {
        contentType: "image/jpeg",
      }),
    ]);
    const result = await fetchCover("https://covers.example.com/a.jpg", "x_1.jpg", {
      dir: tempCoverDir("notimage"),
      lookup: PUBLIC_LOOKUP,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("not-an-image");
  });

  it("accepts a jpeg with a missing content-type when the magic bytes match", async () => {
    stubFetchSequence([streamResponse([JPEG], { contentType: null })]);
    const result = await fetchCover("https://covers.example.com/a.jpg", "x_1.jpg", {
      dir: tempCoverDir("no-ct"),
      lookup: PUBLIC_LOOKUP,
    });
    expect(result.ok).toBe(true);
  });

  it("accepts webp magic bytes", async () => {
    stubFetchSequence([streamResponse([WEBP], { contentType: "image/webp" })]);
    const result = await fetchCover("https://covers.example.com/a.webp", "x_1.jpg", {
      dir: tempCoverDir("webp"),
      lookup: PUBLIC_LOOKUP,
    });
    expect(result.ok).toBe(true);
  });
});

describe("coverFilename", () => {
  it("sanitises the identifier into a single safe path segment", () => {
    const name = coverFilename("audnexus", "../../etc/passwd");
    expect(name).not.toContain("/");
    expect(name).not.toContain("..");
  });
});

describe("MAX_COVER_BYTES", () => {
  it("stays at 8 MB", () => {
    expect(MAX_COVER_BYTES).toBe(8 * 1024 * 1024);
  });
});
