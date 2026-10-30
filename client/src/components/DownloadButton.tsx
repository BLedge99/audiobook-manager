import { useState } from "react";
import { Check, Download, LoaderCircle, Trash2 } from "lucide-react";
import type { Audiobook } from "../types";
import type { DownloadProgress } from "../local/download";
import { DownloadStalledError } from "../local/trace";
import { copy } from "../copy";
import { Btn, Notice } from "../ui/primitives";

export interface DownloadButtonProps {
  book: Audiobook;
  /** 0..1. Non-zero means a partial download is on the device. */
  fraction: number;
  isDownloaded: boolean;
  bytes: number;
  onDownload: (book: Audiobook, onProgress: (p: DownloadProgress) => void) => Promise<void>;
  onRemove: (bookId: number) => Promise<{ failed: string[] }>;
}

/**
 * Download / remove control for one book (spec 26, Sprint 2).
 *
 * Progress is reported from the real per-track byte counts rather than faked,
 * because an audiobook is long enough that "downloading..." with no movement is
 * indistinguishable from broken.
 *
 * This is the one screen in the app where an honest progress state outranks
 * decoration. The bar is always the same height, the percentage is always
 * visible in tabular figures, and a failure never hides which stage broke --
 * that trace is the only thing that makes a stalled 40-hour transfer fixable.
 */
export function DownloadButton({
  book,
  fraction,
  isDownloaded,
  bytes,
  onDownload,
  onRemove,
}: DownloadButtonProps) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string>();
  const [trace, setTrace] = useState<string[]>();

  const percent = Math.round((busy ? progress : fraction) * 100);

  const start = async () => {
    setBusy(true);
    setError(undefined);
    setTrace([]);
    setProgress(0);
    try {
      // Unwrap here: the callback reports a whole DownloadProgress (which also
      // carries per-track detail), and storing that object as a number would
      // render "Downloading NaN%".
      await onDownload(book, (update) => setProgress(update.fraction));
    } catch (downloadError) {
      // Show the message *and* the stage trace. A bare message hides the one
      // thing that matters -- which stage broke -- and this pipeline stalled
      // silently for a long time precisely because the catch produced nothing
      // worth reading. The trace is mirrored to the console so logcat carries
      // the same information.
      const message =
        downloadError instanceof Error ? downloadError.message : String(downloadError);
      setError(message);
      const steps = downloadError instanceof DownloadStalledError ? downloadError.trace : [];
      setTrace(steps.map((s) => `${s.stage} — ${s.status} (${s.ms}ms)`));
      console.error("[download] FAILED:", message, steps);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await onRemove(book.id);
      if (result.failed.length > 0) {
        setError(copy.download.removedWithErrors(result.failed.length));
      }
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : copy.download.removeFailed);
    } finally {
      setBusy(false);
    }
  };

  if (isDownloaded) {
    return (
      <div className="grid gap-2">
        <Btn variant="quiet" onClick={() => void remove()} disabled={busy}>
          {busy ? (
            <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
          ) : (
            <Trash2 size={16} aria-hidden="true" />
          )}
          {copy.download.removeFromDevice}
        </Btn>
        <p className="flex items-center gap-2 text-[12.5px] font-bold text-mint-ink">
          <Check size={14} aria-hidden="true" />
          {copy.download.onThisDevice(formatBytes(bytes))}
        </p>
        {error && <Notice tone="warn" role="status">{error}</Notice>}
        {trace && trace.length > 0 && (
          <ol className="panel panel--sunk mt-1 list-inside list-disc px-4 py-2 space-y-0.5 font-mono text-[11px] text-ink2">
            {trace.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <Btn variant="primary" onClick={() => void start()} disabled={busy}>
        {busy ? (
          <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
        ) : (
          <Download size={16} aria-hidden="true" />
        )}
        {busy ? copy.download.downloading(percent) : fraction > 0 ? copy.download.resume : copy.download.download}
      </Btn>

      {(busy || fraction > 0) && (
        <div
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={copy.download.progressLabel(book.title)}
          className="tube"
        >
          <i style={{ width: `${percent}%` }} />
        </div>
      )}

      {error && <Notice tone="error" role="status">{error}</Notice>}
      {trace && trace.length > 0 && (
        <ol className="panel panel--sunk mt-1 list-inside list-disc px-4 py-2 space-y-0.5 font-mono text-[11px] text-ink2">
          {trace.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "";
  const mb = bytes / (1024 * 1024);
  return mb < 1024 ? `${mb.toFixed(0)} MB` : `${(mb / 1024).toFixed(1)} GB`;
}