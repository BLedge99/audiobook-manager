/**
 * Error codes for the local layer (spec 37, step 8.3).
 *
 * The file/download layer used to raise `Error`s whose message was a
 * user-facing sentence. That made the sentence impossible to test without the
 * 52 KB copy catalogue, and untestable headlessly. Now the layer raises a
 * `LocalError` carrying a stable `code` and the values the sentence needs;
 * the caller maps the code to copy. The `message` is the code itself — never
 * read for display.
 */
export type LocalErrorCode =
  | "bridge-not-ready"
  | "filesystem-unavailable"
  | "file-transfer-unavailable"
  /** The server answered with an HTTP error (401/403 overwhelmingly). */
  | "download-rejected"
  /** Any other HTTP status from the server. */
  | "track-failed"
  /** The plugin's raw message, redacted. */
  | "plugin-failed"
  | "cannot-reach-server"
  | "download-no-data"
  | "download-incomplete"
  | "size-unreadable"
  | "no-tracks";

export interface LocalErrorData {
  httpStatus?: number;
  bytes?: number;
  expectedBytes?: number;
  title?: string;
  detail?: string;
  /** Plugin message, with media tokens redacted. */
  message?: string;
}

export class LocalError extends Error {
  readonly code: LocalErrorCode;
  readonly data?: LocalErrorData;

  constructor(code: LocalErrorCode, data?: LocalErrorData) {
    super(code);
    this.name = "LocalError";
    this.code = code;
    this.data = data;
  }
}
