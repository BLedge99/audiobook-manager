import { useEffect, useMemo, useState } from "react";
import { Link2, Trash2, X } from "lucide-react";
import type { ExternalItem } from "../local/db";
import { copy } from "../copy";
import { EXTERNAL_STORES, parseStoreUrl, type ExternalStoreId } from "../lib/externalStores";
import { Btn, cn } from "../ui/primitives";
import { urlCoverKey, CoverImage } from "../local/CoverImage";

/**
 * Spec 39 — Feature A. Books the listener owns in other stores, kept on this
 * device, always opened in the store's own app. Nothing here is playable,
 * progress-tracked or synced; the rows are launch records.
 */

export type EligibleRole = "admin" | "member" | "child" | undefined;

const badgeTone: Record<ExternalStoreId, string> = {
  audible: "border-[#D89A3A]/70 text-[#8A5A12] bg-[#FDF3DE]",
  playbooks: "border-[#3C77D6]/60 text-[#1E4F8F] bg-[#EAF1FB]",
  kobo: "border-[#D65AB8]/60 text-[#8F1E73] bg-[#FBEAF4]",
  librofm: "border-[#3CB16F]/60 text-[#175C31] bg-[#E9F8EE]",
};

function StoreBadge({ store }: { store: ExternalStoreId }) {
  const def = EXTERNAL_STORES[store];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        badgeTone[store],
      )}
    >
      {def.label}
    </span>
  );
}

function ExternalBookCard({
  item,
  onLaunch,
  onRemove,
}: {
  item: ExternalItem;
  onLaunch: (item: ExternalItem) => void;
  onRemove: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const def = EXTERNAL_STORES[item.store];

  return (
    <article data-external-id={item.id} className="capsule flex gap-3 p-3">
      <button
        type="button"
        onClick={() => onLaunch(item)}
        aria-label={copy.external.openNamed(item.title, def.label)}
        className="min-w-0 flex-1 text-left"
      >
        <span className="relative block">
          <span className="shell-art relative block overflow-hidden">
            {item.coverUrl ? (
              <CoverImage cacheKey={urlCoverKey(item.coverUrl)} />
            ) : (
              <img
                src="/placeholder-cover.svg"
                alt=""
                aria-hidden="true"
                className="h-full w-full object-cover"
              />
            )}
          </span>
          <span className="absolute left-1.5 top-1.5">
            <StoreBadge store={item.store} />
          </span>
        </span>
        <span className="block pt-2">
          <span className="line-clamp-2 block font-display text-[14.5px] font-semibold leading-tight text-ink">
            {item.title}
          </span>
          {item.author && (
            <span className="mt-0.5 block truncate text-[12px] text-ink2">{item.author}</span>
          )}
          <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-bold text-cobalt">
            <Link2 size={11} aria-hidden="true" /> {copy.external.openIn(def.label)} →
          </span>
        </span>
      </button>
      <span className="flex shrink-0 flex-col items-end justify-end gap-1 pb-1">
        {confirming ? (
          <span className="grid justify-items-end gap-1">
            <span className="text-[11px] font-bold text-ink2">{copy.external.removeConfirm}</span>
            <span className="flex gap-1.5">
              <Btn size="sm" variant="quiet" onClick={() => onRemove(item.id)}>
                {copy.external.removeConfirmYes}
              </Btn>
              <Btn size="sm" variant="plain" onClick={() => setConfirming(false)}>
                {copy.external.cancel}
              </Btn>
            </span>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            aria-label={copy.external.removeNamed(item.title)}
            title={copy.external.removeNamed(item.title)}
            className="grid size-8 place-items-center rounded-full text-ink3 transition hover:bg-rasp hover:text-white"
          >
            <Trash2 size={15} aria-hidden="true" />
          </button>
        )}
      </span>
    </article>
  );
}

/** The Library-tab section. Renders nothing for child profiles or empty lists. */
export function ExternalBooks({
  role,
  items,
  onLaunch,
  onRemove,
}: {
  role: EligibleRole;
  items: ExternalItem[];
  onLaunch: (item: ExternalItem) => void;
  onRemove: (id: string) => Promise<void>;
}) {
  if (role === "child" || items.length === 0) return null;
  return (
    <section aria-labelledby="external-books" className="mt-8">
      <h2
        id="external-books"
        className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-ink3"
      >
        {copy.external.heading}
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {items.map((item) => (
          <ExternalBookCard key={item.id} item={item} onLaunch={onLaunch} onRemove={onRemove} />
        ))}
      </div>
    </section>
  );
}

/**
 * "I own this elsewhere" — paste a store URL, fix the prefilled details,
 * add. No network calls: the parse is local, the fields are editable.
 */
export function AddExternalBookDialog({
  open,
  role,
  onClose,
  onAdd,
}: {
  open: boolean;
  role?: EligibleRole;
  onClose: () => void;
  onAdd: (
    url: string,
    overrides: { title?: string; author?: string | null },
  ) => Promise<{ ok: true } | { ok: false; code: string }>;
}) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const parsed = useMemo(() => (url.trim() ? parseStoreUrl(url) : undefined), [url]);

  // Reset state whenever the dialog closes, so a half-filled paste never
  // lingers behind the next open.
  useEffect(() => {
    if (!open) {
      setUrl("");
      setTitle("");
      setAuthor("");
      setSubmitting(false);
    }
  }, [open]);

  // Prefill the editable fields from the URL as the listener pastes. The
  // slug is never trustworthy prose, so it prefills verbatim; the listener
  // edits it here before it becomes the stored title.
  useEffect(() => {
    if (parsed?.ok) {
      setTitle((current) => (current ? current : parsed.titleHint ?? ""));
    }
  }, [parsed]);

  if (role === "child" || !open) return null;

  const ready = parsed?.ok === true;
  const storeLabel = parsed?.ok ? EXTERNAL_STORES[parsed.store].label : null;
  const showError = url.trim().length > 3 && parsed && !parsed.ok;

  const submit = async () => {
    if (!ready || submitting) return;
    setSubmitting(true);
    const result = await onAdd(url.trim(), { title: title.trim(), author: author.trim() || null });
    setSubmitting(false);
    if (result.ok) onClose();
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="add-external-title" className="fixed inset-0 z-50">
      <button type="button" aria-label={copy.buyLinks.close} className="absolute inset-0 cursor-default bg-ink/45" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-[22px] border border-ink/20 bg-surface p-5 shadow-[0_-6px_30px_rgba(0,0,0,0.25)] sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:max-h-none sm:w-[30rem] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[22px]">
        <div className="flex items-start justify-between gap-3">
          <h2 id="add-external-title" className="font-display text-lg font-semibold leading-snug text-ink">
            {copy.external.addTitle}
          </h2>
          <button type="button" onClick={onClose} aria-label={copy.buyLinks.close} className="grid size-9 place-items-center rounded-full text-ink3 hover:bg-sunk">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <p className="mt-1.5 text-[13px] leading-snug text-ink2">{copy.external.addBody}</p>

        <label className="mt-4 block">
          <span className="sr-only">{copy.external.pastePlaceholder}</span>
          <input
            autoFocus
            type="url"
            inputMode="url"
            placeholder={copy.external.pastePlaceholder}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
            className="w-full rounded-[14px] border border-ink/25 bg-sunk px-4 py-2.5 text-[15px] text-ink placeholder:text-ink3 focus:border-ink focus:outline-none"
          />
        </label>

        {showError && <p className="mt-2 text-[12.5px] font-semibold text-rasp-ink">{copy.external.invalidLink}</p>}

        {ready && storeLabel && (
          <div className="mt-3 grid gap-2.5 rounded-[16px] border border-ink/20 bg-sunk/60 p-3">
            <StoreBadge store={(parsed as Extract<typeof parsed, { ok: true }>).store} />
            <label className="block">
              <span className="text-[11px] font-bold uppercase tracking-wide text-ink3">{copy.external.titleField}</span>
              <input
                aria-label={copy.external.titleField}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="mt-1 w-full rounded-[12px] border border-ink/20 bg-surface px-3 py-2 text-[14px] text-ink focus:border-ink focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-bold uppercase tracking-wide text-ink3">{copy.external.authorField}</span>
              <input
                aria-label={copy.external.authorField}
                value={author}
                onChange={(event) => setAuthor(event.target.value)}
                className="mt-1 w-full rounded-[12px] border border-ink/20 bg-surface px-3 py-2 text-[14px] text-ink focus:border-ink focus:outline-none"
              />
            </label>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <Btn variant="quiet" size="sm" onClick={onClose}>
            {copy.external.cancel}
          </Btn>
          <Btn size="sm" onClick={() => void submit()} disabled={!ready || submitting}>
            {submitting ? copy.external.adding : copy.external.add}
          </Btn>
        </div>
      </div>
    </div>
  );
}
