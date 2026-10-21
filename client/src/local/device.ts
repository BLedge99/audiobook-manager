/**
 * Native wiring for the device replica (spec 26, Sprint 2).
 *
 * The only module that talks to Capacitor plugins. Everything it implements sits
 * behind `FileSystemPort`, so `replica.ts` and `download.ts` stay testable in
 * jsdom with an in-memory fake and never touch a plugin.
 *
 * ## Why the plugin imports are lazy
 *
 * Importing `@capacitor/core` (or a plugin built on it) at module scope makes
 * the import chain evaluate before Capacitor's bridge has been injected. The
 * resulting stub then stays in place, and the first real bridge call throws
 * `Cannot read properties of undefined (reading 'triggerEvent')` -- which
 * blanks the entire screen with no useful stack.
 *
 * That is not hypothetical: it is what happened twice while building this. The
 * first time App.tsx called `Capacitor.isNativePlatform()` during the first
 * render; the second time `useDeviceLibrary` pulled these imports in at module
 * scope. `require`/`import()` inside the method defers evaluation until the
 * bridge definitely exists, and keeps the failure mode as a caught error inside
 * one filesystem call rather than a white screen.
 *
 * `lib/platform.ts` avoids the problem a different way, by reading
 * `window.Capacitor` defensively and never importing the module at all.
 */

// `import type` deliberately, not `import { type Directory }`. The latter is a
// value import with a type-only specifier, which esbuild keeps as a bare
// side-effect import -- and that is enough to evaluate the plugin's
// `registerPlugin` at module scope, which is the blank-screen crash.
import type { Directory } from "@capacitor/filesystem";
import { profileHeaders } from "../lib/api";
import { isNativeShell } from "../lib/platform";
import { localDb } from "./db";
import type { FileSystemPort } from "./replica";
import { copy } from "../copy";

type FilesystemPlugin = (typeof import("@capacitor/filesystem"))["Filesystem"];

/**
 * Resolve the Filesystem plugin on first use rather than at module scope.
 *
 * `registerPlugin` runs when the module is imported, and importing it during the
 * app's module evaluation happens before Capacitor's bridge has been injected --
 * which leaves a stub behind and blanks the screen on the first bridge call.
 */
/**
 * Reach a Capacitor plugin **without importing its module**.
 *
 * ## Why not `await import("@capacitor/filesystem")`
 *
 * Both of these were written as dynamic imports to avoid evaluating
 * `registerPlugin` at module scope, which blanks the screen (see the note at
 * the top of this file). On device, though, the bundled dynamic import compiled
 * to a Vite preload wrapper whose promise **never settled**: the download hung
 * silently on its first line, `await fs()`.
 *
 * That is why the plugin probe looked healthy while the app's download button
 * did nothing -- the probe used `window.Capacitor.Plugins.FileTransfer`
 * directly and never touched the import. Two code paths, one of them broken,
 * and I spent a long time proving the network worked while no request had ever
 * been made.
 *
 * `window.Capacitor.Plugins` is the bridge's own registry, populated by the
 * native side before the web app loads, so it needs no module graph and no
 * import at all. `lib/platform.ts` already takes exactly this approach for the
 * same reason; this finally applies it to the plugins.
 *
 * Both functions stay `async` so callers are unchanged.
 */
function pluginRegistry(): Record<string, unknown> {
  const bridge = (globalThis as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
  const plugins = bridge?.Plugins;
  if (!plugins) {
    throw new Error(copy.errors.bridgeNotReady);
  }
  return plugins;
}

let filesystemPlugin: FilesystemPlugin | undefined;
async function fs(): Promise<FilesystemPlugin> {
  if (!filesystemPlugin) {
    filesystemPlugin = pluginRegistry().Filesystem as FilesystemPlugin;
    if (!filesystemPlugin) throw new Error(copy.errors.filesystemUnavailable);
  }
  return filesystemPlugin;
}

type FileTransferPlugin = (typeof import("@capacitor/file-transfer"))["FileTransfer"];

let fileTransferPlugin: FileTransferPlugin | undefined;
async function fileTransfer(): Promise<FileTransferPlugin> {
  if (!fileTransferPlugin) {
    fileTransferPlugin = pluginRegistry().FileTransfer as FileTransferPlugin;
    if (!fileTransferPlugin) throw new Error(copy.errors.fileTransferUnavailable);
  }
  return fileTransferPlugin;
}

/**
 * Turn a plugin failure into something worth showing a household user.
 *
 * `FileTransfer` reports real error codes, unlike the deprecated
 * `Filesystem.downloadFile`. The important one is `OS-PLUG-FLTR-0010`: the
 * server answered with an HTTP error. That is overwhelmingly an auth failure
 * here, and saying "HTTP 401" is far more use than "the operation failed".
 */
export function describeTransferError(error: unknown): Error {
  const candidate = error as { code?: string; message?: string; data?: { httpStatus?: number; body?: string } };
  const httpStatus = candidate?.data?.httpStatus;
  if (httpStatus === 401 || httpStatus === 403) {
    return new Error(copy.errors.downloadRejected(httpStatus));
  }
  if (typeof httpStatus === "number") {
    return new Error(copy.errors.trackFailed(httpStatus));
  }
  const message = candidate?.message || copy.errors.downloadFailed;
  // A connection failure says nothing useful on its own. "The server is down"
  // and "the phone cannot reach the server" look identical to the person
  // holding the phone, and they have different fixes -- so the message names
  // both.
  if (/connect|unreachable|refused|timeout/i.test(message)) {
    return new Error(copy.errors.downloadCannotReach);
  }
  return new Error(message);
}

/**
 * Did the file we wrote actually match what the server said it would send?
 *
 * This is the guard that stops a failure being recorded as success. A 401 or a
 * 500 body is small and perfectly valid to write to disk, and a download that
 * "succeeded" then left a book marked as on-device with no playable audio in
 * it -- which is worse than an outright error, because the UI says you have it.
 *
 * `expectedBytes` is the Content-Length from the transfer; 0 means the server
 * did not report a length, in which case we only check that *something* landed.
 */
export function validateDownloadedSize(bytes: number, expectedBytes: number): void {
  if (bytes <= 0) {
    throw new Error(copy.errors.downloadNoData);
  }
  if (expectedBytes <= 0) return;
  // A small tolerance: some servers pad or the final chunk is reported early.
  const tolerance = Math.max(1024, Math.floor(expectedBytes * 0.01));
  if (Math.abs(bytes - expectedBytes) > tolerance) {
    throw new Error(
      copy.errors.downloadIncomplete(bytes, expectedBytes),
    );
  }
}

/**
 * `Directory.Data`, not `Directory.Documents`.
 *
 * `Documents` is the *shared* Public Documents folder on Android and needs
 * legacy-storage permissions on 10 and scoped-storage grants on 11+, which a
 * sideloaded app should not be asking a household user for. `Data` is
 * app-private: no permission prompt, and Android will not evict it the way it
 * evicts browser storage. ADR 012 already accepts the trade-off that these files
 * are then invisible in the phone's Files app.
 */
const DEVICE_DIRECTORY = "DATA" as Directory;

/** The WebView scheme for an app-private file, without importing the bridge. */
function convertFileSrc(fileUri: string): string {
  const bridge = (window as unknown as { Capacitor?: { convertFileSrc?: (uri: string) => string } }).Capacitor;
  if (typeof bridge?.convertFileSrc !== "function") {
    throw new Error(copy.errors.bridgeNotReady);
  }
  return bridge.convertFileSrc(fileUri);
}

/**
 * Did `mkdir` fail only because the directory is already there?
 *
 * `recursive: true` creates parents but still rejects a pre-existing final
 * directory, so this is the normal case for every download after the first of a
 * book, not a failure.
 */
export function isDirectoryExists(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  return code === "OS-PLUG-FILE-0010";
}

/**
 * Is a plugin progress event about *this* download?
 *
 * Matched on the path and query rather than exact string equality. Two
 * downloads of different tracks have different paths, so this separates them
 * correctly while tolerating whatever normalisation the plugin applied to the
 * URL it reports back.
 */
export function isSameDownload(reported: string | undefined, requested: string): boolean {
  if (!reported) return false;
  if (reported === requested) return true;
  return tail(reported) === tail(requested);
}

function tail(url: string): string {
  const withoutScheme = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const slash = withoutScheme.indexOf("/");
  const rest = slash === -1 ? withoutScheme : withoutScheme.slice(slash);
  // Compare decoded, so a plugin that percent-encodes the session token still
  // matches. Guarded: malformed escapes fall back to the raw text.
  try {
    return decodeURIComponent(rest);
  } catch {
    return rest;
  }
}

/**
 * `FileSystemPort` backed by the real plugins.
 *
 * Every method assumes a filesystem call on the Web platform will simply fail,
 * which is fine: the browser has no device library to manage, so nothing should
 * call it there.
 */
export const deviceFiles: FileSystemPort = {
  async download({ url, path, headers, onProgress }) {
    const Filesystem = await fs();
    const FileTransfer = await fileTransfer();

    // FileTransfer writes to a **full path**, not a directory-relative path like
    // Filesystem.downloadFile took, so resolve it first. It also will not create
    // the parent directory, which is why this is explicit here.
    //
    // OS-PLUG-FILE-0010 ("Directory already exists") is *not* an error to raise:
    // every download after the first for a given book hits it, because the
    // directory was created by the track before it. The previous implementation
    // let `recursive: true` on downloadFile handle this implicitly; calling
    // mkdir unconditionally broke every download after the first.
    const parent = path.split("/").slice(0, -1).join("/");
    if (parent) {
      try {
        await Filesystem.mkdir({ path: parent, directory: DEVICE_DIRECTORY, recursive: true });
      } catch (error) {
        if (!isDirectoryExists(error)) throw error;
      }
    }
    const { uri } = await Filesystem.getUri({ path, directory: DEVICE_DIRECTORY });

    // Progress events fire on the plugin, not per call, so they must be
    // attributed. `type` separates download from upload; the URL check is a
    // second guard for concurrent tracks. An earlier version compared URLs with
    // `!==`, matched nothing, and left the bar at 0% for the whole transfer.
    let listener: { remove: () => Promise<void> } | undefined;
    let expectedBytes = 0;
    if (onProgress) {
      const handle = await FileTransfer.addListener("progress", (progress) => {
        if (progress.type !== "download") return;
        if (!isSameDownload(progress.url, url)) return;
        if (progress.lengthComputable && progress.contentLength > 0) {
          expectedBytes = progress.contentLength;
        }
        if (!progress.contentLength) return;
        onProgress(progress.bytes / progress.contentLength);
      });
      listener = { remove: handle.remove };
    }

    // Announce before the call and confirm after. If this is where a download
    // hangs, the missing second line is the whole diagnosis.
    console.log(`[download] plugin downloadFile -> ${url.replace(/session=[^&]*/, "session=...")}`);
    try {
      await FileTransfer.downloadFile({
        url,
        path: uri,
        progress: Boolean(onProgress),
        headers,
        // The plugin defaults to a 60s read timeout, which a long track over
        // flaky WiFi can exceed mid-file, aborting a download that was working.
        readTimeout: 120_000,
        connectTimeout: 30_000,
      });
      console.log("[download] plugin downloadFile returned");
    } catch (error) {
      console.log("[download] plugin downloadFile threw:", error);
      throw describeTransferError(error);
    } finally {
      // Always detach: a leaked listener keeps firing for the life of the
      // WebView and mis-reports progress for the next download.
      await listener?.remove();
    }

    const { size } = await Filesystem.stat({ path, directory: DEVICE_DIRECTORY });
    console.log(`[download] wrote ${size} bytes to ${path}`);
    return { path, bytes: size, expectedBytes };
  },

  async remove(path) {
    const Filesystem = await fs();
    await Filesystem.deleteFile({ path, directory: DEVICE_DIRECTORY });
  },

  async stat(path) {
    const Filesystem = await fs();
    const { size } = await Filesystem.stat({ path, directory: DEVICE_DIRECTORY });
    return size;
  },

  async playableUrl(path) {
    const Filesystem = await fs();
    // `getUri` turns an app-private file into an absolute `file://` URL, and
    // `convertFileSrc` maps that onto a scheme the WebView may load. A raw
    // `file://` URL is blocked. This is also what makes seeking work: the
    // element gets a real URL with range support, not a blob.
    const { uri } = await Filesystem.getUri({ path, directory: DEVICE_DIRECTORY });
    return convertFileSrc(uri);
  },
};

/** True when the device library is meaningful on this platform. */
export function supportsDeviceLibrary(): boolean {
  return isNativeShell();
}

/** Headers the server needs on audio requests, scoped to the current profile. */
export function deviceAuthHeaders(): Record<string, string> {
  return profileHeaders();
}

export { localDb };
