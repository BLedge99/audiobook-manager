import path from "node:path";
import { test, expect, Page, APIRequestContext } from "@playwright/test";
import { E2E_API_URL, E2E_PASSWORD } from "../helpers";

const API = E2E_API_URL;

async function cookieFor(request: any): Promise<string> {
  const res = await request.post(`${API}/api/auth/login`, { data: { password: E2E_PASSWORD } });
  const setCookie = res.headers()["set-cookie"];
  // A missing cookie means auth is disabled or the password is wrong; both
  // make every assertion below meaningless, so fail loudly instead.
  if (!setCookie) {
    throw new Error(
      `Login to ${API} did not return a session cookie. Is the server running with APP_PASSWORD=${E2E_PASSWORD}?`,
    );
  }
  return setCookie.split(";")[0];
}

/** Ensure at least one scanned audiobook exists, scanning only if needed. */
async function ensureScannedLibrary(request: APIRequestContext): Promise<{ cookie: string; bookId: number }> {
  const cookie = await cookieFor(request);
  const auth = { cookie };

  const existing = (await (await request.get(`${API}/api/audiobooks`, { headers: auth })).json()) as { id: number }[];
  if (existing.length > 0) return { cookie, bookId: existing[0].id };

  // Works both natively (repo-relative) and inside docker (mounted at /test).
  const candidates = [
    process.env.E2E_LIBRARY_PATH,
    path.resolve(__dirname, "..", "..", "test"),
    "/test",
  ].filter(Boolean) as string[];

  let rootId: number | undefined;
  for (const candidate of candidates) {
    const attempt = await request.post(`${API}/api/library-roots`, {
      headers: auth,
      data: { path: candidate, label: "security-fixture" },
    });
    if (attempt.status() === 201) {
      rootId = ((await attempt.json()) as { id: number }).id;
      break;
    }
    // Only an inaccessible path is worth retrying with another candidate.
    if (attempt.status() !== 400) {
      throw new Error(`Adding library root ${candidate} failed with ${attempt.status()}: ${await attempt.text()}`);
    }
  }
  expect(rootId, "no usable library fixture path was accepted by the server").toBeDefined();

  const started = await request.post(`${API}/api/scan`, { headers: auth, data: { rootId } });
  expect(started.status()).toBe(202);

  // Wait for *this* root's scan to finish rather than merely for books to
  // appear: a bare count is satisfied instantly by a previous run's leftovers.
  await expect
    .poll(
      async () => {
        const status = (await (await request.get(`${API}/api/scan/status`, { headers: auth })).json()) as {
          rootId: number;
          status: { status: string };
        }[];
        return status.find((entry) => Number(entry.rootId) === Number(rootId))?.status.status;
      },
      { timeout: 240_000, intervals: [2000, 4000, 8000] },
    )
    .toBe("complete");

  const books = (await (await request.get(`${API}/api/audiobooks`, { headers: auth })).json()) as { id: number }[];
  expect(books.length, "scan produced no audiobooks").toBeGreaterThan(0);
  return { cookie, bookId: books[0].id };
}

test("unauthenticated requests are rejected", async ({ request }) => {
  for (const path of ["/api/audiobooks", "/api/profiles", "/api/library-roots", "/api/history"]) {
    const res = await request.get(`${API}${path}`);
    expect(res.status(), path).toBe(401);
  }
});

test("malformed and traversal-ish IDs do not crash the server", async ({ request }) => {
  const cookie = await cookieFor(request);
  const auth = { cookie };
  // A non-numeric id must be rejected by validation or simply not found.
  // What matters is that none of them reaches the database layer and 500s.
  for (const id of ["abc", "-1", "0", "..%2F..%2Fetc", "999999999"]) {
    for (const route of ["/api/audiobooks/:id", "/api/audiobooks/:id/stream", "/api/audiobooks/:id/progress"]) {
      const url = route.replace(":id", id);
      const res = await request.get(`${API}${url}`, { headers: auth });
      expect([400, 404], `${url} id=${id} returned ${res.status()}`).toContain(res.status());
    }
  }
});

test("range abuse is rejected with 416", async ({ request }) => {
  test.setTimeout(300_000);
  const { cookie, bookId } = await ensureScannedLibrary(request);
  for (const range of ["bytes=99999999999-", "bytes=-abc", "bytes=5-1"]) {
    const res = await request.get(`${API}/api/audiobooks/${bookId}/stream`, { headers: { cookie, range } });
    expect(res.status(), `range ${range}`).toBe(416);
    // The client is told why it cannot be served.
    expect(res.headers()["content-range"], `range ${range}`).toMatch(/^bytes \*\/\d+$/);
  }
});

test("invalid payloads are rejected with 4xx, not 500", async ({ request }) => {
  const cookie = await cookieFor(request);
  const auth = { cookie };

  const badPassword = await request.post(`${API}/api/auth/login`, { data: { password: 42 } });
  expect([400, 401]).toContain(badPassword.status());

  const profiles = await (await request.get(`${API}/api/profiles`, { headers: auth })).json();
  expect(profiles.length, "the security suite needs at least one profile").toBeGreaterThan(0);
  const profileId = (profiles[0] as { id: number }).id;

  // Use a real book id so this asserts payload validation, not a 404.
  const books = await (await request.get(`${API}/api/audiobooks`, { headers: auth })).json();
  const bookId = (books[0] as { id: number } | undefined)?.id;
  test.skip(!bookId, "no scanned audiobook available");

  const res = await request.post(`${API}/api/audiobooks/${bookId}/sessions`, {
    headers: { ...auth, "x-profile-id": String(profileId) },
    data: {},
  });
  expect(res.status()).toBe(400);

  const badJson = await request.post(`${API}/api/profiles`, {
    headers: { cookie, "content-type": "application/json" },
    data: "{not json",
  });
  expect(badJson.status()).toBe(400);
});

/**
 * Specs 16-20 added a large surface of new routes. Each one takes ids and
 * JSON bodies, so the spec 11 rules apply: validated schemas, 4xx on bad input,
 * and no absolute server paths in the response.
 */
test.describe("metadata and discovery routes", () => {
  test("new routes reject malformed ids with 4xx, not 500", async ({ request }) => {
    const cookie = await cookieFor(request);
    const auth = { cookie };

    for (const path of [
      "audiobooks/not-a-number/tags",
      "audiobooks/99999999/candidates",
      "tags/not-a-number",
      "genres/not-a-number",
      "discover/similar/not-a-number",
      "wishlist/not-a-number",
    ]) {
      const res = await request.get(`${API}/api/${path}`, { headers: auth });
      expect([400, 404], `${path} returned ${res.status()}`).toContain(res.status());
    }
  });

  test("wishlist and favourite routes require a profile", async ({ request }) => {
    const cookie = await cookieFor(request);
    const books = await (await request.get(`${API}/api/audiobooks`, { headers: { cookie } })).json();
    const bookId = (books[0] as { id: number } | undefined)?.id;
    test.skip(!bookId, "no scanned audiobook available");

    // Without x-profile-id these are profile-scoped and must refuse rather
    // than silently acting on a null profile.
    for (const [method, path] of [
      ["put", `audiobooks/${bookId}/favourite`],
      ["delete", `audiobooks/${bookId}/favourite`],
    ] as const) {
      const res = await request[method](`${API}/api/${path}`, { headers: { cookie } });
      expect(res.status(), `${method} ${path} returned ${res.status()}`).toBe(400);
    }

    const favourites = await request.get(`${API}/api/favourites`, { headers: { cookie } });
    expect(favourites.status()).toBe(400);
  });

  test("tag creation rejects invalid and reserved names with 4xx", async ({ request }) => {
    const cookie = await cookieFor(request);
    const profiles = await (await request.get(`${API}/api/profiles`, { headers: { cookie } })).json();
    const profileId = (profiles[0] as { id: number } | undefined)?.id;
    test.skip(!profileId, "the security suite needs at least one profile");
    const auth = { cookie, "x-profile-id": String(profileId) };

    // Reserved route names collide with client-side navigation.
    const reserved = await request.post(`${API}/api/tags`, { headers: auth, data: { name: "discover" } });
    expect(reserved.status()).toBe(409);

    // A name colliding with a genre must not create a duplicate facet.
    const genreClash = await request.post(`${API}/api/tags`, { headers: auth, data: { name: "Mystery & Thriller" } });
    expect(genreClash.status()).toBe(409);

    const empty = await request.post(`${API}/api/tags`, { headers: auth, data: { name: "" } });
    expect(empty.status()).toBe(400);
  });

  test("wishlist rejects a save with no provider key", async ({ request }) => {
    const cookie = await cookieFor(request);
    const profiles = await (await request.get(`${API}/api/profiles`, { headers: { cookie } })).json();
    const profileId = (profiles[0] as { id: number } | undefined)?.id;
    test.skip(!profileId, "the security suite needs at least one profile");

    // providerKey is what dedupes wishlist rows; without it the row could
    // never be identified again.
    const res = await request.post(`${API}/api/wishlist`, {
      headers: { cookie, "x-profile-id": String(profileId) },
      data: { title: "No Key", provider: "audnexus" },
    });
    expect(res.status()).toBe(400);
  });

  test("no route leaks an absolute server filesystem path", async ({ request }) => {
    const cookie = await cookieFor(request);
    const auth = { cookie };

    const books = await (await request.get(`${API}/api/audiobooks`, { headers: auth })).json();
    const bookId = (books[0] as { id: number } | undefined)?.id;
    test.skip(!bookId, "no scanned audiobook available");

    // Spec 11: API errors and responses must not expose absolute host paths.
    const payloads: unknown[] = [books];
    payloads.push(await (await request.get(`${API}/api/audiobooks/${bookId}`, { headers: auth })).json());
    payloads.push(await (await request.get(`${API}/api/audiobooks/${bookId}/candidates`, { headers: auth })).json());
    payloads.push(await (await request.get(`${API}/api/enrichment/review-queue`, { headers: auth })).json());
    payloads.push(await (await request.get(`${API}/api/audiobooks/${bookId}/tags`, { headers: auth })).json());

    const serialised = JSON.stringify(payloads);
    expect(serialised).not.toMatch(/\/app\/data/);
    expect(serialised).not.toMatch(/\/test\//);
    expect(serialised).not.toContain("filePath");
    expect(serialised).not.toContain("coverImagePath");
  });

  test("a cover URL pointing at the host itself is refused", async ({ request }) => {
    const cookie = await cookieFor(request);
    const profiles = await (await request.get(`${API}/api/profiles`, { headers: { cookie } })).json();
    const profileId = (profiles[0] as { id: number } | undefined)?.id;
    test.skip(!profileId, "the security suite needs at least one profile");
    const books = await (await request.get(`${API}/api/audiobooks`, { headers: { cookie } })).json();
    const bookId = (books[0] as { id: number } | undefined)?.id;
    test.skip(!bookId, "no scanned audiobook available");

    // SSRF: the server fetches a client-supplied URL. Pointing it at the
    // host's own metadata service must not succeed.
    const res = await request.post(`${API}/api/audiobooks/${bookId}/metadata`, {
      headers: { cookie, "x-profile-id": String(profileId) },
      data: { coverUrl: "http://169.254.169.254/latest/meta-data/" },
    });
    expect([200, 400]).toContain(res.status());
    // The request is accepted but the cover is never stored.
    const item = await (await request.get(`${API}/api/audiobooks/${bookId}`, { headers: { cookie } })).json();
    expect(JSON.stringify(item)).not.toContain("169.254.169.254");
  });
});
