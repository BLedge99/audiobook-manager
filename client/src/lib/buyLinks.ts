/**
 * The buy-link builder (spec 39 — Feature B, Phase 6).
 *
 * Pure: no network, no DOM. The sheet renders whatever this returns; tests
 * in `buyLinks.test.ts` are authoritative for shape.
 *
 * Rules that matter legally, not just technically:
 * - never a price, never a comparison, never urgency phrasing;
 * - LibriVox row first and untagged — it is the only fact (free) on the sheet;
 * - affiliate tags are appended only when VITE_AFFILIATE_* is set, and the
 *   value is treated as an opaque query-string fragment, not parsed, because
 *   parameter names are bound at signup (plan §9.4);
 * - Audible is deliberately not representable as a paid/affiliate row — the
 *   sideloaded app cannot be an Approved Mobile Application (ADR 034).
 */
import { getAffiliateTags, type AffiliableVendor } from "./affiliateConfig";
import { normaliseIsbn } from "./isbn";

export type BuyLinkId = "librivox" | AffiliableVendor | "audible" | "playbooks";

export interface BuyLink {
  id: BuyLinkId;
  kind: "free" | "store";
  /** Display label next to the button; vendor words only, never prices. */
  label: string;
  href: string;
  /** True ⇒ UI must render the "Ad · we may earn a commission" cue on the button. */
  commission: boolean;
}

export interface BuyLinkInput {
  title: string;
  author?: string | null;
  /** Anything ISBN-ish; normalised here. Bad input is ignored. */
  isbn?: string | null;
  /** Present only when LibriVox actually has this work — else the row is omitted. */
  librivoxUrl?: string | null;
}

/** Append an opaque affiliate fragment as another query parameter. */
function withTag(href: string, tag: string | undefined): string {
  if (!tag) return href;
  const glue = href.includes("?") ? "&" : "?";
  return `${href}${glue}${tag.replace(/^[?&]/, "")}`;
}

export function buildBuyLinks(input: BuyLinkInput): BuyLink[] {
  const isbn13 = normaliseIsbn(input.isbn);
  const query = isbn13 ?? `${input.title.trim()} ${(input.author ?? "").trim()}`.trim();
  const q = encodeURIComponent(query);
  const tags = getAffiliateTags();

  const links: BuyLink[] = [];

  if (input.librivoxUrl) {
    links.push({
      id: "librivox",
      kind: "free",
      label: "LibriVox — Free",
      href: input.librivoxUrl,
      commission: false,
    });
  }

  links.push(
    {
      id: "librofm",
      kind: "store",
      label: "Libro.fm",
      href: withTag(`https://libro.fm/?q=${q}`, tags.librofm),
      commission: Boolean(tags.librofm),
    },
    {
      id: "bookshop",
      kind: "store",
      label: "Bookshop.org",
      href: withTag(`https://bookshop.org/search?keywords=${q}`, tags.bookshop),
      commission: Boolean(tags.bookshop),
    },
    {
      id: "bn",
      kind: "store",
      label: "Barnes & Noble",
      href: withTag(
        isbn13
          ? `https://www.barnesandnoble.com/s/${q}?ean=${isbn13}`
          : `https://www.barnesandnoble.com/s/${q}`,
        tags.bn,
      ),
      commission: Boolean(tags.bn),
    },
    {
      id: "kobo",
      kind: "store",
      label: "Kobo",
      href: withTag(`https://www.kobo.com/us/en/search?query=${q}`, tags.kobo),
      commission: Boolean(tags.kobo),
    },
    {
      id: "audible",
      kind: "store",
      label: "Audible",
      href: `https://www.audible.com/search?keywords=${q}`,
      commission: false,
    },
    {
      id: "playbooks",
      kind: "store",
      label: "Google Play Books",
      href: `https://play.google.com/store/search?q=${q}&c=books`,
      commission: false,
    },
  );

  return links;
}
