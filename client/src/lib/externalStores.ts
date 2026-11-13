/**
 * The store registry (spec 39, Phase 1) — the single source of truth for
 * "which store hosts this URL, and how do we launch it".
 *
 * Pure: no network, no DOM, no Date. Everything here is unit-tested in
 * `externalStores.test.ts`; the tests, not this comment, are authoritative.
 *
 * What a store entry may decide: identity parsing, canonicalisation, search
 * URLs, badge label, install URL. What it may never do: build ASINs,
 * construct product URLs from ISBNs, follow shorteners, scrape, or ship a
 * price.
 */

/** The four stores v1 supports. */
export type ExternalStoreId = "audible" | "playbooks" | "kobo" | "librofm";

export interface StoreMatch {
  /** ASIN (audible), Play id (playbooks), slug (kobo), ISBN-13 (librofm). */
  externalId: string;
  /** Canonicalised product URL — strip everything except identity. */
  httpsUrl: string;
  /** Human hint recovered from the slug, if any (prefill for the add dialog). */
  titleHint?: string;
}

export interface StoreDef {
  id: ExternalStoreId;
  /** Display name; doubles as the badge and the AD-cue vendor name. */
  label: string;
  /** Android package for the explicit launch; null only where unverified. */
  packageName: string | null;
  /** Play Store listing — shown when the store app is not installed. */
  installUrl: string;
  /** True when `host` (lowercased, leading "www." stripped) is this store's. */
  ownsHost(host: string): boolean;
  /** Product page URL → identity, or null. */
  parseProductUrl(url: URL): StoreMatch | null;
  /** Fallback when we have only a title/author (buy rows). */
  searchUrl(query: string): string;
}

export type ParseResult =
  | ({ ok: true; store: ExternalStoreId } & StoreMatch)
  | { ok: false; code: "unsupported-host" | "invalid-url" | "unrecognised-shape" };

/** "The-Count-of--Monte-Cristo" → "the count of monte cristo". */
export function deslug(slug: string): string {
  return slug.toLowerCase().replace(/-+/g, " ").replace(/\s+/g, " ").trim();
}

const PLAY_ID = /^(?!.*\.\.)[A-Za-z0-9_-]{5,64}$/;
const KOBO_SLUG = /^[a-z0-9-]{1,120}$/i;
const KOBO_LOCALE = /^[a-z]{2}$/;
const LIBROFM_PATH = /^\/audiobooks\/(\d{13})-(.+)$/;
const AUDIBLE_HOSTS = /^audible\.(com|co\.uk|ca|de|fr|it|es|com\.au|com\.br)$/;

/** Valid ISBN-13 (GS1 range prefix 978/979). */
function isValidIsbn13(isbn: string): boolean {
  if (!/^97[89]\d{10}$/.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(isbn[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(isbn[12]);
}

function stripWww(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

const storeDefs: Record<ExternalStoreId, StoreDef> = {
  audible: Object.freeze({
    id: "audible",
    label: "Audible",
    packageName: "com.audible.application",
    installUrl: "https://play.google.com/store/apps/details?id=com.audible.application",
    ownsHost(host: string) {
      return AUDIBLE_HOSTS.test(host);
    },
    parseProductUrl(url: URL): StoreMatch | null {
      const host = stripWww(url.hostname);
      if (!AUDIBLE_HOSTS.test(host)) return null;
      const match = url.pathname.match(/^\/pd\/([^/]+)\/([A-Z0-9]{10})\/?$/);
      if (!match) return null;
      const [, slug, asin] = match;
      return {
        externalId: asin,
        httpsUrl: `https://www.${host}/pd/${slug}/${asin}`,
        titleHint: deslug(slug) || undefined,
      };
    },
    searchUrl(query: string) {
      return `https://www.audible.com/search?keywords=${encodeURIComponent(query)}`;
    },
  }),

  playbooks: Object.freeze({
    id: "playbooks",
    label: "Google Play Books",
    packageName: "com.google.android.apps.books",
    installUrl: "https://play.google.com/store/apps/details?id=com.google.android.apps.books",
    ownsHost(host: string) {
      return host === "play.google.com";
    },
    parseProductUrl(url: URL): StoreMatch | null {
      if (stripWww(url.hostname) !== "play.google.com") return null;
      const isAudio = url.pathname === "/store/audiobooks/details";
      const isEbook = url.pathname === "/store/books/details";
      if (!isAudio && !isEbook) return null;
      const id = url.searchParams.get("id");
      if (!id || !PLAY_ID.test(id)) return null;
      return { externalId: id, httpsUrl: `https://play.google.com${url.pathname}?id=${id}` };
    },
    searchUrl(query: string) {
      return `https://play.google.com/store/search?q=${encodeURIComponent(query)}&c=books`;
    },
  }),

  kobo: Object.freeze({
    id: "kobo",
    label: "Kobo",
    packageName: "com.kobobooks.android",
    installUrl: "https://play.google.com/store/apps/details?id=com.kobobooks.android",
    ownsHost(host: string) {
      return host === "kobo.com";
    },
    parseProductUrl(url: URL): StoreMatch | null {
      if (stripWww(url.hostname) !== "kobo.com") return null;
      const match = url.pathname.match(/^\/([a-z]{2})\/([a-z]{2})\/audiobook\/([^/]+)\/?$/);
      if (!match) return null;
      const [, region, lang, slug] = match;
      if (!KOBO_LOCALE.test(region) || !KOBO_LOCALE.test(lang)) return null;
      if (!KOBO_SLUG.test(slug)) return null;
      // The slug is not a stable public id; identity is the canonical URL.
      return { externalId: slug, httpsUrl: `https://www.kobo.com/${region}/${lang}/audiobook/${slug}` };
    },
    searchUrl(query: string) {
      // Region pinned to us/en; a configurable registry would be over-engineering today.
      return `https://www.kobo.com/us/en/search?query=${encodeURIComponent(query)}`;
    },
  }),

  librofm: Object.freeze({
    id: "librofm",
    label: "Libro.fm",
    packageName: "fm.libro.librofm",
    installUrl: "https://play.google.com/store/apps/details?id=fm.libro.librofm",
    ownsHost(host: string) {
      return host === "libro.fm";
    },
    parseProductUrl(url: URL): StoreMatch | null {
      if (stripWww(url.hostname) !== "libro.fm") return null;
      const match = url.pathname.match(LIBROFM_PATH);
      if (!match) return null;
      const [, isbn] = match;
      if (!isValidIsbn13(isbn)) return null;
      return { externalId: isbn, httpsUrl: `https://libro.fm${url.pathname}` };
    },
    searchUrl(query: string) {
      return `https://libro.fm/?q=${encodeURIComponent(query)}`;
    },
  }),
};

export const EXTERNAL_STORES: Readonly<Record<ExternalStoreId, StoreDef>> = Object.freeze(storeDefs);

/** Parse a pasted store URL. Never throws. */
export function parseStoreUrl(raw: string): ParseResult {
  const input = raw.trim();
  if (!input) return { ok: false, code: "invalid-url" };

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, code: "invalid-url" };
  }

  // Plain http links are accepted and upgraded; anything else is rejected.
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:") return { ok: false, code: "invalid-url" };

  const host = stripWww(url.hostname);
  const owner = Object.values(EXTERNAL_STORES).find((store) => store.ownsHost(host));
  if (!owner) return { ok: false, code: "unsupported-host" };
  const match = owner.parseProductUrl(url);
  return match ? { ok: true, store: owner.id, ...match } : { ok: false, code: "unrecognised-shape" };
}
