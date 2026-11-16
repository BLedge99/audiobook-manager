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
import { EXTERNAL_STORES, EXTRA_VENDORS } from "./externalStores";

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

/** The scheme we will render into an href. Anything else (javascript:, data:, ...) is dropped. */
function safeExternalHref(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol === "https:") return url.toString();
    if (url.protocol === "http:") {
      url.protocol = "https:";
      return url.toString();
    }
    return null;
  } catch {
    return null;
  }
}

export function buildBuyLinks(input: BuyLinkInput): BuyLink[] {
  const isbn13 = normaliseIsbn(input.isbn);
  const query = isbn13 ?? `${input.title.trim()} ${(input.author ?? "").trim()}`.trim();
  // The registry encodes its queries itself; only the affiliate fragment
  // rides on top, appended via withTag.
  const tags = getAffiliateTags();

  const links: BuyLink[] = [];

  // The LibriVox URL originates server-side and ultimately from LibriVox
  // metadata; render it only if it is a plain web URL (never javascript:/data:).
  const freeHref = input.librivoxUrl ? safeExternalHref(input.librivoxUrl) : null;
  if (freeHref) {
    links.push({
      id: "librivox",
      kind: "free",
      label: "LibriVox — Free",
      href: freeHref,
      commission: false,
    });
  }

  links.push(
    {
      id: "librofm",
      kind: "store",
      label: EXTERNAL_STORES.librofm.label,
      href: withTag(EXTERNAL_STORES.librofm.searchUrl(query), tags.librofm),
      commission: Boolean(tags.librofm),
    },
    {
      id: "bookshop",
      kind: "store",
      label: EXTRA_VENDORS.bookshop.label,
      href: withTag(EXTRA_VENDORS.bookshop.searchUrl(query), tags.bookshop),
      commission: Boolean(tags.bookshop),
    },
    {
      id: "bn",
      kind: "store",
      label: EXTRA_VENDORS.bn.label,
      href: withTag(EXTRA_VENDORS.bn.searchUrl(query, isbn13), tags.bn),
      commission: Boolean(tags.bn),
    },
    {
      id: "kobo",
      kind: "store",
      label: EXTERNAL_STORES.kobo.label,
      href: withTag(EXTERNAL_STORES.kobo.searchUrl(query), tags.kobo),
      commission: Boolean(tags.kobo),
    },
    {
      id: "audible",
      kind: "store",
      label: EXTERNAL_STORES.audible.label,
      // Deliberately not representable as a paid/affiliate row (ADR 034):
      // no tag, ever, whatever the environment holds.
      href: EXTERNAL_STORES.audible.searchUrl(query),
      commission: false,
    },
    {
      id: "playbooks",
      kind: "store",
      label: EXTERNAL_STORES.playbooks.label,
      href: EXTERNAL_STORES.playbooks.searchUrl(query),
      commission: false,
    },
  );

  return links;
}
