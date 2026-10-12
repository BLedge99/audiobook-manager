import { describe, it, expect } from "vitest";
import {
  METADATA_FIELDS,
  resolveField,
  resolveFields,
  scannableFields,
  toPrismaData,
} from "./precedence";
import { GENRE_TAXONOMY, PROVIDER_GENRE_MAPPING } from "./taxonomy";

/**
 * Spec 17 / ADR 009 — per-field precedence.
 *
 * Table-driven and pure: no database needed, which is the point of keeping the
 * resolver dependency-free.
 */

describe("resolveField precedence", () => {
  it("prefers a user override over everything else", () => {
    const resolved = resolveField("title", {
      override: "My Title",
      enriched: "Enriched Title",
      embedded: "Embedded Title",
      derived: "Folder Name",
    });
    expect(resolved.value).toBe("My Title");
    expect(resolved.source).toBe("override");
    expect(resolved.isOverridden).toBe(true);
  });

  it("prefers enriched over embedded when there is no override", () => {
    const resolved = resolveField("title", { enriched: "Enriched Title", embedded: "Embedded Title" });
    expect(resolved.source).toBe("enriched");
    expect(resolved.isOverridden).toBe(false);
  });

  it("prefers embedded over the filename-derived fallback", () => {
    const resolved = resolveField("title", { embedded: "Embedded Title", derived: "12_creepytales" });
    expect(resolved.value).toBe("Embedded Title");
    expect(resolved.source).toBe("embedded");
  });

  it("falls through to the derived value last", () => {
    const resolved = resolveField("title", { derived: "12_creepytales_1206_librivox" });
    expect(resolved.source).toBe("derived");
  });

  it("returns null when every layer is empty", () => {
    const resolved = resolveField("title", {});
    expect(resolved.value).toBeNull();
    expect(resolved.source).toBeNull();
    expect(resolved.isOverridden).toBe(false);
  });

  it("treats whitespace-only values as absent at every layer", () => {
    // A provider returning "  " must not blank out an embedded title.
    const resolved = resolveField("title", { override: "   ", enriched: "  ", embedded: "Real Title" });
    expect(resolved.value).toBe("Real Title");
    expect(resolved.source).toBe("embedded");
  });

  it("treats an empty override as no override at all", () => {
    const resolved = resolveField("title", { override: null, enriched: "Enriched" });
    expect(resolved.source).toBe("enriched");
    expect(resolved.isOverridden).toBe(false);
  });

  it("trims the winning value", () => {
    expect(resolveField("author", { override: "  Mary Shelley  " }).value).toBe("Mary Shelley");
  });
});

describe("scannableFields", () => {
  it("allows every field when nothing is overridden", () => {
    expect(scannableFields([])).toEqual(new Set(METADATA_FIELDS));
  });

  it("locks only the overridden field", () => {
    // The core ADR 009 fix: fixing a narrator must not freeze the title.
    const writable = scannableFields(["narrator"]);
    expect(writable.has("narrator")).toBe(false);
    expect(writable.has("title")).toBe(true);
    expect(writable.has("author")).toBe(true);
  });

  it("locks several fields at once", () => {
    const writable = scannableFields(["title", "coverImagePath"]);
    expect(writable.has("title")).toBe(false);
    expect(writable.has("coverImagePath")).toBe(false);
    expect(writable.has("publisher")).toBe(true);
  });

  it("ignores an unknown field name rather than locking everything", () => {
    const writable = scannableFields(["notARealField"]);
    expect(writable).toEqual(new Set(METADATA_FIELDS));
  });
});

describe("resolveFields", () => {
  it("resolves every declared field", () => {
    const resolved = resolveFields({ title: { override: "T" } });
    for (const field of METADATA_FIELDS) {
      expect(resolved[field]).toBeDefined();
    }
    expect(resolved.title?.value).toBe("T");
    expect(resolved.author?.value).toBeNull();
  });

  it("tolerates a missing layer entry for a field", () => {
    const resolved = resolveFields({});
    expect(resolved.title?.value).toBeNull();
  });
});

describe("toPrismaData", () => {
  it("maps resolved fields to column names", () => {
    const data = toPrismaData({
      title: { field: "title", value: "Dune", source: "override", isOverridden: true },
      publishedYear: { field: "publishedYear", value: "1965", source: "enriched", isOverridden: false },
      seriesPosition: { field: "seriesPosition", value: "1.5", source: "enriched", isOverridden: false },
    });
    expect(data.title).toBe("Dune");
    expect(data.publishedYear).toBe(1965);
    expect(data.seriesPosition).toBe(1.5);
  });

  it("drops a non-numeric year rather than writing NaN", () => {
    const data = toPrismaData({
      publishedYear: { field: "publishedYear", value: "not a year", source: "enriched", isOverridden: false },
    });
    expect(data.publishedYear).toBeUndefined();
  });

  it("drops a non-numeric series position rather than writing NaN", () => {
    const data = toPrismaData({
      seriesPosition: { field: "seriesPosition", value: "x", source: "enriched", isOverridden: false },
    });
    expect(data.seriesPosition).toBeUndefined();
  });

  it("carries the series name through for the Series lookup", () => {
    const data = toPrismaData({
      seriesName: { field: "seriesName", value: "The Expanse", source: "enriched", isOverridden: false },
    });
    expect(data.seriesNameRaw).toBe("The Expanse");
  });
});

describe("taxonomy seed integrity", () => {
  it("has no duplicate top-level slugs", () => {
    const slugs = GENRE_TAXONOMY.map((genre) => genre.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("has no duplicate slugs across the whole tree", () => {
    const all = GENRE_TAXONOMY.flatMap((genre) => [genre.slug, ...(genre.children ?? []).map((c) => c.slug)]);
    expect(new Set(all).size).toBe(all.length);
  });

  it("has exactly one catch-all bucket", () => {
    const catchAll = GENRE_TAXONOMY.filter((genre) => genre.isCatchAll);
    expect(catchAll).toHaveLength(1);
  });

  it("names every seed entry", () => {
    for (const genre of GENRE_TAXONOMY) {
      expect(genre.name).toBeTruthy();
      for (const child of genre.children ?? []) {
        expect(child.name).toBeTruthy();
      }
    }
  });

  it("only maps to slugs the taxonomy actually defines", () => {
    const known = new Set(GENRE_TAXONOMY.flatMap((genre) => [genre.slug, ...(genre.children ?? []).map((c) => c.slug)]));
    const dangling: string[] = [];
    for (const [provider, mapping] of Object.entries(PROVIDER_GENRE_MAPPING)) {
      for (const [raw, slug] of Object.entries(mapping)) {
        if (!known.has(slug)) dangling.push(`${provider}:"${raw}" -> ${slug}`);
      }
    }
    // A dangling mapping would silently never match.
    expect(dangling).toEqual([]);
  });

  it("maps every provider onto a known provider id", () => {
    for (const provider of Object.keys(PROVIDER_GENRE_MAPPING)) {
      expect(["audnexus", "librivox", "googlebooks", "openlibrary"]).toContain(provider);
    }
  });

  it("covers the Audnexus genre names the provider actually emits", () => {
    const audnexus = PROVIDER_GENRE_MAPPING.audnexus;
    expect(audnexus["mystery, thriller & suspense"]).toBeDefined();
    expect(audnexus["literary fiction"]).toBeDefined();
    expect(audnexus["science fiction"]).toBeDefined();
  });
});