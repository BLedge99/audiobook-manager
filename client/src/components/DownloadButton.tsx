import { useState } from "react";
import { Check, Download, LoaderCircle, Trash2 } from "lucide-react";
import type { Audiobook } from "../types";
import type { DownloadProgress } from "../local/download";

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

  const percent = Math.round((busy ? progress : fraction) * 100);

  const start = async () => {
    setBusy(true);
    setError(undefined);
    setProgress(0);
    try {
      // Unwrap here: the callback reports a whole DownloadProgress (which also
      // carries per-track detail), and storing that object as a number would
      // render "Downloading NaN%".
      await onDownload(book, (update) => setProgress(update.fraction));
    } catch (downloadError) {
      // Kept specific rather than generic: the most likely cause by far is that
      // the phone left the home WiFi, and "Could not download" hides that.
      setError(
        downloadError instanceof Error
          ? `Download failed: ${downloadError.message}. The phone may have left the home WiFi.`
          : "Download failed.",
      );
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
        setError(`Removed from the library, but ${result.failed.length} file(s) could not be deleted.`);
      }
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Could not remove the book.");
    } finally {
      setBusy(false);
    }
  };

  if (isDownloaded) {
    return (
      <div className="grid gap-2">
        <button
          type="button"
          onClick={() => void remove()}
          disabled={busy}
          className="flex items-center justify-center gap-2 border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-red-700 hover:text-red-300 disabled:opacity-60"
        >
          {busy ? (
            <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
          ) : (
            <Trash2 size={16} aria-hidden="true" />
          )}
          Remove from device
        </button>
        <p className="flex items-center gap-2 text-xs text-emerald-300">
          <Check size={14} aria-hidden="true" />
          On this device · {formatBytes(bytes)}
        </p>
        {error && <p className="text-xs text-amber-300" role="status">{error}</p>}
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <button
        type="button"
        onClick={() => void start()}
        disabled={busy}
        className="flex items-center justify-center gap-2 bg-cyan-400 px-4 py-2 font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-60"
      >
        {busy ? (
          <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
        ) : (
          <Download size={16} aria-hidden="true" />
        )}
        {busy ? `Downloading ${percent}%` : fraction > 0 ? "Resume download" : "Download"}
      </button>

      {(busy || fraction > 0) && (
        <div
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Download progress for ${book.title}`}
          className="h-1.5 w-full bg-slate-800"
        >
          <div className="h-full bg-cyan-400 transition-[width]" style={{ width: `${percent}%` }} />
        </div>
      )}

      {error && <p className="text-xs text-red-300" role="status">{error}</p>}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "";
  const mb = bytes / (1024 * 1024);
  return mb < 1024 ? `${mb.toFixed(0)} MB` : `${(mb / 1024).toFixed(1)} GB`;
}