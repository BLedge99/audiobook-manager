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
