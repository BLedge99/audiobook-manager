/**
 * Build-time affiliate tags (spec 39 / ADR 034).
 *
 * Affiliate participation is self-service only (Libro.fm/Awin, Kobo/Rakuten,
 * Bookshop.org, Barnes & Noble/Impact) and is optional per vendor: an absent
 * or empty `VITE_AFFILIATE_*` tag renders the identical sheet untagged. The
 * one tag that can never exist is Amazon — a sideloaded household app cannot
 * be an Approved Mobile Application, so Audible links always render untagged
 * and the buy-link builder hard-codes that (see Phase 6).
 *
 * Tokens are not secrets — they identify the household's affiliate account,
 * not any user — but they are build-time config, not source-controlled data.
 * The production demo may inject them; local builds normally ship untagged.
 */

/** Every vendor that may carry a self-service affiliate tag. Ordered. */
export type AffiliableVendor = "librofm" | "bookshop" | "kobo" | "bn";

export type AffiliateTags = Partial<Record<AffiliableVendor, string>>;

/** Read the configured tags; an empty/whitespace value means "untagged". */
export function getAffiliateTags(): AffiliateTags {
  const env = import.meta.env as Record<string, string | undefined>;
  const out: AffiliateTags = {};
  const pick = (id: AffiliableVendor, key: string) => {
    const value = env[key]?.trim();
    if (value) out[id] = value;
  };
  pick("librofm", "VITE_AFFILIATE_LIBROFM");
  pick("bookshop", "VITE_AFFILIATE_BOOKSHOP");
  pick("kobo", "VITE_AFFILIATE_KOBO");
  pick("bn", "VITE_AFFILIATE_BN");
  return out;
}

/** True when the vendor has a configured tag and therefore earns commission. */
export function isCommissionable(id: AffiliableVendor): boolean {
  return Boolean(getAffiliateTags()[id]);
}
