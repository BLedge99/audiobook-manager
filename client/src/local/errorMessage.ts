/**
 * Map a local-layer failure to the sentence the listener sees (spec 37, step 8.3).
 *
 * The file layer raises `LocalError` with a code; this is the only seam where
 * codes become words. Unknown (non-local) errors pass their message through,
 * matching the previous behaviour of the screens that render them.
 */
import { copy } from "../copy";
import { LocalError } from "./errors";

export function localErrorMessage(
  error: unknown,
  messages: typeof copy.errors = copy.errors,
): string {
  if (!(error instanceof LocalError)) {
    return error instanceof Error && error.message ? error.message : String(error);
  }
  switch (error.code) {
    case "bridge-not-ready":
      return messages.bridgeNotReady;
    case "filesystem-unavailable":
      return messages.filesystemUnavailable;
    case "file-transfer-unavailable":
      return messages.fileTransferUnavailable;
    case "download-rejected":
      return messages.downloadRejected(error.data?.httpStatus ?? 0);
    case "track-failed":
      return messages.trackFailed(error.data?.httpStatus ?? 0);
    case "cannot-reach-server":
      return messages.cannotReachServer;
    case "download-no-data":
      return messages.downloadNoData;
    case "download-incomplete":
      return messages.downloadIncomplete(error.data?.bytes ?? 0, error.data?.expectedBytes ?? 0);
    case "size-unreadable":
      return messages.sizeUnreadable(error.data?.detail ?? "");
    case "no-tracks":
      return messages.noTracks(error.data?.title ?? "");
    case "plugin-failed":
      return messages.downloadFailed;
  }
}
