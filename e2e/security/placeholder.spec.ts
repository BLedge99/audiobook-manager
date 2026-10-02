// Placeholder for the security project (spec 11). Intentionally a trivial
// passing placeholder until spec 11 implements the real suite.
import { test, expect } from "@playwright/test";

test("security project placeholder", async ({ request }) => {
  const res = await request.get("http://localhost:3000/api/health");
  expect(res.ok()).toBeTruthy();
});
