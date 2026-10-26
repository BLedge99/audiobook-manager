import { useState } from "react";
import { Btn } from "../ui/primitives";
import { copy } from "../copy";
import { describeFailure } from "../lib/api";

/**
 * Spec 27: taking a book out of your library.
 *
 * ## Two questions, asked in the right order
 *
 * Leaving the library is **recoverable** -- the book stays on the server and
 * the "All books" tab can add it back -- so it does not need a confirmation.
 * Deleting the *download* is **not** recoverable, so that is the one worth
 * asking about, and the question is only asked when there is a download to ask
 * about.
 *
 * ## One implementation, two places
 *
 * The question appears on the book page and in the "All books" tab, and the
 * two must not drift apart. So the logic lives here, in a hook, and the two
 * surfaces render it.
 *
 * ## Why the pieces are split
 *
 * The question needs more room than a button has. On the book page it
 * replaces the button in place; in the tab it appears *below* the row, because
 * a 360px phone has no width for a two-answer question beside a title. So the
 * state is a hook (the caller owns where it is shown) and the panel is a
 * component.
 */

export interface RemoveFromLibraryOptions {
  /** The book to remove. */
  bookId: number;
  /**
   * Whether the book is downloaded to this device.
   *
   * It decides whether the question is asked at all.
   */
  isDownloaded: boolean;
  /** Take the book out of the calling profile's library. */
  onRemove: (bookId: number) => Promise<void>;
  /**
   * Delete the device copy, freeing the space.
   *
   * Optional: there is no device library in the browser or the PWA.
   */
  onDeleteDownload?: (bookId: number) => Promise<{ failed: string[] }>;
  /** Called once the removal is done, so the caller can close its question. */
  onDone?: () => void;
}

export interface RemoveFromLibraryState {
  /** Is the question open? */
  asking: boolean;
  /** Is a removal in flight? */
  busy: boolean;
  /** Why the last attempt failed, if it did. */
  error: string | undefined;
  /**
   * What the Remove button does.
   *
   * Asking about the download is only worth it when there IS a download to
   * ask about. With nothing downloaded, leaving the library is recoverable --
   * the book stays on the server and the "All books" tab can add it back -- so
   * it happens in one tap, with no question.
   */
  start: () => void;
  /** Close the question. */
  cancel: () => void;
  /**
   * Carry out the removal.
   *
   * `deleteDownload` is the answer to the question, and it is only ever true
   * when the question was asked.
   */
  confirm: (deleteDownload: boolean) => Promise<void>;
}

export function useRemoveFromLibrary(options: RemoveFromLibraryOptions): RemoveFromLibraryState {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const ask = () => {
    setError(undefined);
    setAsking(true);
  };

  const start = () => {
    if (options.isDownloaded) ask();
    else void confirm(false);
  };

  const cancel = () => {
    setAsking(false);
    setError(undefined);
  };

  const confirm = async (deleteDownload: boolean) => {
    setBusy(true);
    setError(undefined);
    try {
      if (deleteDownload && options.onDeleteDownload) {
        const result = await options.onDeleteDownload(options.bookId);
        await options.onRemove(options.bookId);
        if (result.failed.length > 0) setError(copy.removeBook.deleteFailed);
      } else {
        await options.onRemove(options.bookId);
      }
      setAsking(false);
      options.onDone?.();
    } catch (removalFailure) {
      setError(describeFailure(removalFailure, copy.errors.removeFromLibrary));
    } finally {
      setBusy(false);
    }
  };

  return { asking, busy, error, start, cancel, confirm };
}

/**
 * The question and its two answers.
 *
 * `onKeepDownload` and `onDeleteDownload` are the two answers. When there is
 * no download, only one button is shown, because the question has no second
 * part to ask.
 */
export function RemoveFromLibraryQuestion({
  asking,
  busy,
  error,
  hasDownload,
  onKeepDownload,
  onDeleteDownload,
  onCancel,
}: {
  asking: boolean;
  busy: boolean;
  error: string | undefined;
  /** Whether there is a download to ask about. */
  hasDownload: boolean;
  onKeepDownload: () => void;
  onDeleteDownload: () => void;
  onCancel: () => void;
}) {
  if (!asking) return null;

  return (
    <div
      className="panel panel--flat px-3 py-3"
      role="group"
      aria-label={copy.removeBook.question}
    >
      <p className="text-[13.5px] font-semibold text-ink">{copy.removeBook.question}</p>
      {hasDownload && (
        <p className="mt-1 text-[13px] text-ink2">{copy.removeBook.alsoDelete}</p>
      )}
      {error && (
        <p role="alert" className="mt-1.5 text-[12.5px] font-bold text-rasp-ink">
          {error}
        </p>
      )}
      <div className="mt-2.5 flex flex-wrap gap-2">
        {hasDownload ? (
          <>
            <Btn size="sm" variant="primary" disabled={busy} onClick={onDeleteDownload}>
              {copy.removeBook.deleteDownload}
            </Btn>
            <Btn size="sm" variant="quiet" disabled={busy} onClick={onKeepDownload}>
              {copy.removeBook.keepDownload}
            </Btn>
          </>
        ) : (
          <Btn size="sm" variant="primary" disabled={busy} onClick={onKeepDownload}>
            {copy.removeBook.action}
          </Btn>
        )}
        <Btn size="sm" variant="quiet" disabled={busy} onClick={onCancel}>
          {copy.common.cancel}
        </Btn>
      </div>
    </div>
  );
}
