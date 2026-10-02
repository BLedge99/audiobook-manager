import { test, expect, Page } from "@playwright/test";
import { E2E_PASSWORD } from "../helpers";

async function cookieFor(request: any): Promise<string> {
  const res = await request.post("http://localhost:3000/api/auth/login", { data: { password: E2E_PASSWORD } });
  const setCookie = res.headers()["set-cookie"];
  return setCookie.split(";")[0];
}

test("unauthenticated requests are rejected", async ({ request }) => {
  for (const path of ["/api/audiobooks", "/api/profiles", "/api/library-roots", "/api/history"]) {
    const res = await request.get(`http://localhost:3000${path}`);
    expect(res.status(), path).toBe(401);
  }
});

test("malformed and traversal-ish IDs do not crash the server", async ({ request }) => {
  const cookie = await cookieFor(request);
  for (const id of ["abc", "-1", "..%2F..%2Fetc", "0", "999999999", "..%2f..%2f"]) {
    const res = await request.get(`http://localhost:3000/api/audiobooks/${id}/stream`, { headers: { cookie } });
    expect([400, 403, 404]).toContain(res.status());
  }
});

test("range abuse is rejected with 416", async ({ request }) => {
  test.setTimeout(240_000);
  const cookie = await cookieFor(request);
  const created = await request.post("http://localhost:3000/api/library-roots", {
    headers: { cookie },
    data: { path: "/mnt/c/Users/benle/Documents/Projects/TechNative/audiobook-manager/test", label: "security-fixture" },
  });
  expect(created.status()).toBe(201);
  const roots = await (await request.get("http://localhost:3000/api/library-roots", { headers: { cookie } })).json();
  const rootId = roots[0].id;
  await request.post("http://localhost:3000/api/scan", { headers: { cookie }, data: { rootId } });
  await expect.poll(async () => {
    const books = await (await request.get("http://localhost:3000/api/audiobooks", { headers: { cookie } })).json();
    return books.length;
  }, { timeout: 180_000, intervals: [2000, 4000, 8000] }).toBeGreaterThan(0);
  const books = await (await request.get("http://localhost:3000/api/audiobooks", { headers: { cookie } })).json();
  const id = books[0].id;
  for (const range of ["bytes=99999999999-", "bytes=-abc", "bytes=5-1"]) {
    const res = await request.get(`http://localhost:3000/api/audiobooks/${id}/stream`, { headers: { cookie, range } });
    expect([416]).toContain(res.status());
  }
});

test("invalid payloads are rejected with 4xx, not 500", async ({ request }) => {
  const cookie = await cookieFor(request);
  const login = await request.get("http://localhost:3000/api/profiles", { headers: { cookie } });
  const profiles = await login.json();
  const profileId = profiles.length ? String(profiles[0].id) : null;

  const badProgress = await request.post("http://localhost:3000/api/auth/login", { data: { password: 42 } });
  expect([400, 401]).toContain(badProgress.status());

  if (profileId) {
    const res = await request.post("http://localhost:3000/api/audiobooks/1/sessions", {
      headers: { cookie, "x-profile-id": profileId },
      data: {},
    });
    expect(res.status()).toBe(400);
  }

  const badJson = await request.post("http://localhost:3000/api/profiles", {
    headers: { cookie, "content-type": "application/json" },
    data: "{not json",
  });
  expect(badJson.status()).toBe(400);
});
