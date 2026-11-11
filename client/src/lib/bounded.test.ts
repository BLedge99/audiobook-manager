import { describe, expect, it } from "vitest";
import { fetchWithDeadline, REQUEST_TIMEOUT_MS } from "./bounded";

/**
 * The deadline rule.
 *
 * A fetch to an unreachable host does not always fail -- it *hangs*. A stale
 * DHCP address on a network that blackholes packets never sends a RST, so the
 * request sits in CONNECT for tens of seconds. A request with no deadline
 * therefore leaves a spinner running for good.
 *
 * The rule lives here, apart from `lib/api.ts`, because two applications need
 * it and only one of them is the family client: the admin panel is a separate
 * bundle with its own credential (ADR 022), and it must not drag the family's
 * session logic into its build.
 */

describe("fetchWithDeadline", () => {
  it("answers normally when the request is quick", async () => {
    const response = await fetchWithDeadline("/api/x", {}, 1000, async () =>
      new Response("ok", { status: 200 }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  it("gives up on a request that never settles", async () => {
    await expect(
      fetchWithDeadline("/api/x", {}, 20, () => new Promise<Response>(() => {})),
    ).rejects.toThrow();
  });

  it("composes with an outer signal rather than replacing it", async () => {
    // A caller that already set a signal keeps it: the deadline is composed
    // with it, not substituted for it.
    const controller = new AbortController();
    const pending = fetchWithDeadline(
      "/api/x",
      { signal: controller.signal },
      10_000,
      () => new Promise<Response>(() => {}),
    );
    controller.abort();
    await expect(pending).rejects.toThrow();
  });

  it("honours a deadline that is already spent", async () => {
    await expect(
      fetchWithDeadline("/api/x", {}, 0, () => new Promise<Response>(() => {})),
    ).rejects.toThrow();
  });

  it("has a deadline long enough for a slow home server", () => {
    // Generous, because a slow home server on a phone is still a working
    // server. Too short and the app calls a working server unreachable.
    expect(REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
    expect(REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
  });
});
