import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, X } from "lucide-react";
import { copy } from "../copy";
import { EXTERNAL_STORES, type ExternalStoreId } from "../lib/externalStores";
import { launchStoreLink } from "../lib/externalIntent";
import { buildBuyLinks, type BuyLink } from "../lib/buyLinks";
import { Btn, cn } from "../ui/primitives";
import { requestRaw } from "../lib/request";

/**
 * Spec 39 — Feature B. "Where do I get this book?"
 *
 * One row per vendor, a Free row when LibriVox actually has the work (we
 * ask our server; librivox.org sends no CORS header, so the browser cannot),
 * and zero prices. Commissionable rows carry the AD cue on the button's row,
 * adjacency being the part that matters (16 CFR Part 255; ASA/CAP). Child
 * sessions see nothing — defense in depth, App gates the affordance too.
 */
export interface GetThisBookSheetProps {
  open: boolean;
  onClose: () => void;
  isChild: boolean;
  title: string;
  author?: string;
  isbn?: string;
}

const PACKAGE_FOR: Partial<Record<BuyLink["id"], ExternalStoreId>> = {
  librofm: "librofm",
  kobo: "kobo",
  audible: "audible",
  playbooks: "playbooks",
};

export function GetThisBookSheet({ open, onClose, isChild, title, author, isbn }: GetThisBookSheetProps) {
  const [librivoxUrl, setLibrivoxUrl] = useState<string | null>(null);

  // One lookup per open. Failure simply omits the Free row — never an error.
  //
  // Through `request`, not a bare `fetch`: the native shell is not same-origin
  // with the API, so a relative URL would resolve against the app origin and
  // the raw call would carry no session — the Free row could never appear in
  // the app. `requestRaw` resolves against the configured server, sends the
  // session (cookie same-origin, header in the shell), and keeps the deadline.
  useEffect(() => {
    if (!open || isChild) {
      setLibrivoxUrl(null);
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({ title });
    if (author?.trim()) params.set("author", author.trim());
    requestRaw(`/api/buy-context?${params.toString()}`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    })
      .then((response) => (response.ok ? response.json() : { librivox: null }))
      .then((body: { librivox?: { url?: string } | null }) => {
        setLibrivoxUrl(typeof body?.librivox?.url === "string" ? body.librivox.url : null);
      })
      .catch(() => setLibrivoxUrl(null));
    return () => controller.abort();
  }, [open, isChild, title, author]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || isChild) return null;

  const links = buildBuyLinks({ title, author, isbn, librivoxUrl });
  const freeLink = links.find((link) => link.kind === "free");
  const paidRows = links.filter((link) => link.kind === "store");
  const networkList = paidRows.filter((link) => link.commission).map((link) => link.label).join(", ");
  const hasCommission = networkList.length > 0;

  const launch = (link: BuyLink) => {
    const storeId = PACKAGE_FOR[link.id];
    const packageName = storeId ? EXTERNAL_STORES[storeId].packageName : null;
    void launchStoreLink(link.href, { packageName });
  };

  // Portals to <body>: the sheet used to render inside the main landmark,
  // whose stacking context trapped the dialog below the sticky header (.bar,
  // z-30). The top rows -- the title and the close button -- were painted
  // behind the header and the header ate the clicks.
  return createPortal(
    <div role="dialog" aria-modal="true" aria-labelledby="get-this-book" className="fixed inset-0 z-50">
      <button type="button" aria-label={copy.buyLinks.close} className="absolute inset-0 cursor-default bg-ink/45" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-[22px] border border-ink/20 bg-surface p-5 shadow-[0_-6px_30px_rgba(0,0,0,0.25)] sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:max-h-none sm:w-[30rem] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[22px]">
        <div className="flex items-start justify-between gap-3">
          <h2 id="get-this-book" className="font-display text-lg font-semibold leading-snug text-ink">
            {copy.buyLinks.sheetTitle}
          </h2>
          <button type="button" onClick={onClose} aria-label={copy.buyLinks.close} className="grid size-9 place-items-center rounded-full text-ink3 hover:bg-sunk">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <ul className="mt-4 grid list-none gap-2">
          {freeLink && (
            <li data-row="librivox" className="flex items-center justify-between gap-3 rounded-[16px] border-2 border-mint bg-[#E9F8EE] p-3">
              <span className="min-w-0">
                <span className="block text-[13.5px] font-bold text-ink">{freeLink.label}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-ink2">{copy.buyLinks.freeCopy}</span>
              </span>
              <a href={freeLink.href} target="_blank" rel="noopener noreferrer" className="shrink-0">
                <Btn size="sm" variant="primary">{copy.buyLinks.freeAction}</Btn>
              </a>
            </li>
          )}
          {paidRows.map((link) => (
            <li key={link.id} data-row={link.id} className="rounded-[16px] border border-ink/15 bg-sunk/50 p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-[13px] font-semibold text-ink2">{link.label}</span>
                <Btn
                  size="sm"
                  variant="quiet"
                  aria-label={`${copy.buyLinks.checkPrice} ${link.label}`}
                  onClick={() => launch(link)}
                  className="shrink-0"
                >
                  {copy.buyLinks.checkPrice} <ExternalLink size={12} aria-hidden="true" className="ml-1 inline" />
                </Btn>
              </div>
              {link.commission && (
                <p className="mt-1.5 text-[10.5px] font-bold uppercase tracking-wide text-ink3">
                  {copy.buyLinks.adCue}
                </p>
              )}
            </li>
          ))}
        </ul>

        <p className={cn("mt-3 border-t border-ink/15 pt-3 text-[10.5px] leading-snug text-ink3")}>
          {hasCommission ? copy.buyLinks.disclosure(networkList) : copy.buyLinks.disclosureNoNetworks}
        </p>
      </div>
    </div>,
    document.body,
  );
}
