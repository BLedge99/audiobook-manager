import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { setSessionCookie } from "./routes";

async function setCookieHeader(secureCookie: boolean): Promise<string> {
  const app = Fastify();
  await app.register(cookie);
  app.get("/login", async (_request, reply) => {
    setSessionCookie(reply, "test-token", { secureCookie } as never);
    return { ok: true };
  });
  const response = await app.inject({ method: "GET", url: "/login" });
  const header = response.headers["set-cookie"];
  return Array.isArray(header) ? header.join("; ") : String(header);
}

describe("setSessionCookie", () => {
  it("sets an httpOnly, lax cookie on plain http", async () => {
    expect(await setCookieHeader(false)).toMatch(/samesite=lax/i);
    expect(await setCookieHeader(false)).toMatch(/httponly/i);
    expect(await setCookieHeader(false)).not.toMatch(/samesite=none/i);
  });

  it("keeps SameSite=Lax on https (never SameSite=None)", async () => {
    // A cross-site cookie widens CSRF surface for no benefit: the browser flow is
    // same-site behind the proxy; the native client uses x-house-session instead.
    const header = await setCookieHeader(true);
    expect(header).toMatch(/samesite=lax/i);
    expect(header).toMatch(/secure/i);
    expect(header).not.toMatch(/samesite=none/i);
  });
});
