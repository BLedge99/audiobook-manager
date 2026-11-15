import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  SHARED_CORS_ORIGINS,
  collectApiDocs,
  registerClientDist,
  sharedCorsOrigins,
} from "./listener";

let dist: string;

beforeEach(() => {
  dist = mkdtempSync(path.join(tmpdir(), "client-dist-"));
  mkdirSync(path.join(dist, "assets"), { recursive: true });
});

afterEach(() => {
  rmSync(dist, { recursive: true, force: true });
});

function writeDist({ withIndex = true } = {}) {
  if (withIndex) writeFileSync(path.join(dist, "index.html"), '<!doctype html><title>Home</title>');
  writeFileSync(path.join(dist, "assets", "app-abc123.js"), "console.log(1);");
}

describe("sharedCorsOrigins (spec 41 step 9.4)", () => {
  it("carries the origins both listeners must agree on", () => {
    expect(SHARED_CORS_ORIGINS).toEqual([
      "http://localhost:5173",
      "http://localhost:3000",
      "https://localhost",
      "http://localhost",
      "https://books.home.arpa",
      "capacitor://localhost",
    ]);
    expect(sharedCorsOrigins().sort()).toEqual([...SHARED_CORS_ORIGINS].sort());
  });

  it("appends and dedupes extras", () => {
    expect(sharedCorsOrigins(["https://auth.example", "http://localhost:3000"])).toContain("https://auth.example");
    expect(sharedCorsOrigins(["http://localhost:3000"])).toHaveLength(SHARED_CORS_ORIGINS.length);
  });
});

describe("collectApiDocs (spec 41 step 9.4)", () => {
  it("records /api routes only", async () => {
    const app = Fastify();
    collectApiDocs(app);
    app.get("/api/ping", { schema: { querystring: { type: "object" } } }, async () => ({ pong: true }));
    app.get("/not-api", async () => ({ pong: true }));
    await app.ready();

    const docs = (app as typeof app & { apiDocs: { method: string; url: string }[] }).apiDocs;
    // onRoute fires for HEAD as well as GET — the admin docs screen shows both.
    expect(docs.map((route) => route.url)).toEqual(["/api/ping", "/api/ping"]);
    expect(docs.map((route) => route.method)).toEqual(["GET", "HEAD"]);
    await app.close();
  });
});

describe("registerClientDist (spec 41 step 9.4)", () => {
  it("reports a missing dist instead of throwing, and registers nothing", async () => {
    const app = Fastify();
    const registered = await registerClientDist(app, {
      distDir: path.join(dist, "does-not-exist"),
      apiNotFound: (_request, reply) => reply.code(404).send({ error: "not_found" }),
    });
    expect(registered).toBe(false);
    const res = await app.inject({ method: "GET", url: "/index.html" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("serves the shell and immutable hashed assets with the right cache headers", async () => {
    writeDist();
    const app = Fastify();
    const registered = await registerClientDist(app, {
      distDir: dist,
      apiNotFound: (_request, reply) => reply.code(404).send({ error: "not_found" }),
    });
    expect(registered).toBe(true);

    const asset = await app.inject({ method: "GET", url: "/assets/app-abc123.js" });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["cache-control"]).toBe("public, max-age=31536000, immutable");

    const shell = await app.inject({ method: "GET", url: "/index.html" });
    expect(shell.statusCode).toBe(200);
    expect(shell.headers["cache-control"]).toBe("public, max-age=0, must-revalidate");
    await app.close();
  });

  it("a missing asset answers 404 with JSON, never index.html (spec 38)", async () => {
    writeDist();
    const app = Fastify();
    await registerClientDist(app, {
      distDir: dist,
      apiNotFound: (_request, reply) => reply.code(404).send({ error: "not_found" }),
    });

    const missing = await app.inject({ method: "GET", url: "/assets/gone.js" });
    expect(missing.statusCode).toBe(404);
    expect(missing.body).not.toContain("<!doctype html>");
    await app.close();
  });

  it("/api misses go to the caller's handler, not the shell", async () => {
    writeDist();
    const app = Fastify();
    await registerClientDist(app, {
      distDir: dist,
      apiNotFound: (_request, reply) => reply.code(404).send({ code: "not_found" }),
    });

    const res = await app.inject({ method: "GET", url: "/api/never-existed" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ code: "not_found" });
    await app.close();
  });

  it("unknown non-asset paths get the shell (SPA fallback)", async () => {
    writeDist();
    const app = Fastify();
    await registerClientDist(app, {
      distDir: dist,
      apiNotFound: (_request, reply) => reply.code(404).send({ error: "not_found" }),
    });

    const res = await app.inject({ method: "GET", url: "/discover/some-book" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("<!doctype html>");
    await app.close();
  });
});
