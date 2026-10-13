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

type FilesystemPlugin = (typeof import("@capacitor/filesystem"))["Filesystem"];

/**
 * Resolve the Filesystem plugin on first use rather than at module scope.
 *
 * `registerPlugin` runs when the module is imported, and importing it during the
 * app's module evaluation happens before Capacitor's bridge has been injected --
 * which leaves a stub behind and blanks the screen on the first bridge call.
 */
let filesystemPlugin: FilesystemPlugin | undefined;
async function fs(): Promise<FilesystemPlugin> {
  if (!filesystemPlugin) {
    filesystemPlugin = (await import("@capacitor/filesystem")).Filesystem;
  }
  return filesystemPlugin;
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
    throw new Error("The device bridge is not ready yet");
  }
  return bridge.convertFileSrc(fileUri);
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
    // The plugin reports progress through a listener on the plugin itself, not
    // a per-call callback, so filter by URL. Without the filter a concurrent
    // download's events would be attributed to this one.
    let listener: { remove: () => Promise<void> } | undefined;
    if (onProgress) {
      const handle = await Filesystem.addListener("progress", (progress) => {
        if (progress.url !== url) return;
        if (!progress.contentLength) return;
        onProgress(progress.bytes / progress.contentLength);
      });
      listener = { remove: handle.remove };
    }

    try {
      await Filesystem.downloadFile({
        url,
        path,
        directory: DEVICE_DIRECTORY,
        // Creates books/<id>/ on the way; without it the first download fails
        // on a directory that does not exist yet.
        recursive: true,
        progress: Boolean(onProgress),
        headers,
      });
    } finally {
      // Always detach: a leaked listener keeps firing for the life of the
      // WebView and mis-reports progress for the next download.
      await listener?.remove();
    }

    const { size } = await Filesystem.stat({ path, directory: DEVICE_DIRECTORY });
    return { path, bytes: size };
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