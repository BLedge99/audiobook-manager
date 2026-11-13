/**
 * Spec 39 / ADR 034 — the buy-link builder. Every behavioural rule:
 *
 * - free row first, paid rows never show a price (§ row order + no price text);
 * - ISBN-13 works when present, title/author search otherwise;
 * - tags are appended only when VITE_AFFILIATE_* is configured, and never
 *   to Audible;
 * - unknown affixes are simply query-string fragments (the real param names
 *   are bound at affiliate signup, see plan §9.4).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { buildBuyLinks } from "./buyLinks";

afterEach(() => {
  vi.unstubAllEnvs();
});

const BASE = { title: "The Picture of Dorian Gray", author: "Oscar Wilde" };

function hrefOf(links: ReturnType<typeof buildBuyLinks>, id: string): string {
  const found = links.find((link) => link.id === id);
  if (!found) throw new Error(`No link with id ${id}`);
  return found.href;
}

describe("row shape", () => {
  it("emits the Free row first, then the six paid rows in stable order", () => {
    const links = buildBuyLinks({ ...BASE, librivoxUrl: "https://librivox.org/x/" });
    expect(links.map((link) => link.id)).toEqual([
      "librivox",
      "librofm",
      "bookshop",
      "bn",
      "kobo",
      "audible",
      "playbooks",
    ]);
    expect(links[0].kind).toBe("free");
    expect(links[0].commission).toBe(false);
    expect(links.slice(1).every((link) => link.kind === "store")).toBe(true);
  });

  it("omits the Free row without a LibriVox match", () => {
    expect(buildBuyLinks({ ...BASE }).map((link) => link.id)).toEqual([
      "librofm",
      "bookshop",
      "bn",
      "kobo",
      "audible",
      "playbooks",
    ]);
  });

  it("never mentions a price in labels or hrefs", () => {
    const links = buildBuyLinks({ ...BASE, librivoxUrl: "https://librivox.org/x/" });
    const text = links.map((link) => `${link.label} ${link.href}`).join(" ");
    expect(text).not.toMatch(/\$|£|€|was |now |lowest|save/i);
  });
});

describe("query construction", () => {
  it("uses ISBN-13 when a valid one is supplied", () => {
    const links = buildBuyLinks({ ...BASE, isbn: "978-0-439-02352-8" });
    expect(hrefOf(links, "librofm")).toContain("q=9780439023528");
    expect(hrefOf(links, "kobo")).toContain("query=9780439023528");
    expect(hrefOf(links, "bn")).toContain("ean=9780439023528");
  });

  it("converts ISBN-10 to 13 for every ISBN-keyed row", () => {
    const links = buildBuyLinks({ ...BASE, isbn: "0-306-40615-2" });
    expect(hrefOf(links, "librofm")).toContain("q=9780306406157");
    expect(hrefOf(links, "bn")).toContain("ean=9780306406157");
  });

  it("falls back to a title+author search when the ISBN is missing or invalid", () => {
    const missing = buildBuyLinks({ ...BASE });
    expect(hrefOf(missing, "librofm")).toContain("q=The%20Picture%20of%20Dorian%20Gray%20Oscar%20Wilde");
    const invalid = buildBuyLinks({ ...BASE, isbn: "9780439023529" });
    expect(hrefOf(invalid, "librofm")).toContain("q=The%20Picture%20of%20Dorian%20Gray%20Oscar%20Wilde");
  });

  it("encodes the query exactly once", () => {
    const links = buildBuyLinks({ title: "A & B", author: "X" });
    expect(hrefOf(links, "audible")).toContain("keywords=A%20%26%20B%20X");
    expect(hrefOf(links, "audible")).not.toContain("%2526");
  });
});

describe("affiliate tags", () => {
  it("appends the configured tag to that vendor's row and marks it commissioned", () => {
    vi.stubEnv("VITE_AFFILIATE_KOBO", "rkkobo=12345");
    const links = buildBuyLinks({ ...BASE });
    const kobo = links.find((link) => link.id === "kobo")!;
    expect(kobo.commission).toBe(true);
    expect(kobo.href).toContain("rkkobo=12345");
  });

  it("leaves other vendors untagged and uncommissioned", () => {
    vi.stubEnv("VITE_AFFILIATE_KOBO", "rkkobo=12345");
    const links = buildBuyLinks({ ...BASE });
    expect(links.find((link) => link.id === "librofm")!.commission).toBe(false);
    expect(links.find((link) => link.id === "bookshop")!.commission).toBe(false);
    expect(links.find((link) => link.id === "bookshop")!.href).not.toContain("rkkobo=12345");
  });

  it("appends to an already-parameterised B&N EAN link, not a fresh ?", () => {
    vi.stubEnv("VITE_AFFILIATE_BN", "bnAffId=987");
    const links = buildBuyLinks({ ...BASE, isbn: "9780439023528" });
    const bn = links.find((link) => link.id === "bn")!;
    expect(bn.href).toContain("ean=9780439023528&bnAffId=987");
  });

  it("works untagged when nothing is configured", () => {
    const links = buildBuyLinks({ ...BASE });
    expect(links.every((link) => !link.commission)).toBe(true);
  });

  it("never tags Audible, whatever the environment holds", () => {
    vi.stubEnv("VITE_AFFILIATE_AUDIBLE", "audible-20");
    const links = buildBuyLinks({ ...BASE });
    const audible = links.find((link) => link.id === "audible")!;
    expect(audible.commission).toBe(false);
    expect(audible.href).not.toContain("audible-20");
  });
});
