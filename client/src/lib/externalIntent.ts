/**
 * Bridge to the native `ExternalIntent` plugin (spec 39 / ADR 034).
 *
 * Contract (native side: ExternalIntentPlugin.java):
 *   canResolve({ url, package? })      -> { value: boolean }
 *   launchIntent({ url, package?, chooserTitle?, requireApp? }) -> { completed: boolean }
 *
 * Resolution rules, identical to the other local plugins:
 * - never at module scope (the bridge may not exist yet at import time),
 * - never via `registerPlugin()` (that blanked the screen twice before),
 * - always via `window.Capacitor.Plugins.ExternalIntent` at call time.
 *
 * Failure never throws into the UI: every method resolves. The caller shows
 * honest fall-back copy ("couldn't open the app — page opened in your
 * browser") when a link had to degrade.
 *
 * URL hygiene: nothing here logs a URL. The console spy in the tests exists
 * to keep it that way.
 */

import { Browser } from "@capacitor/browser";
import { isNativeShell } from "./platform";

export interface ExternalIntentPlugin {
  canResolve(options: { url: string; package?: string }): Promise<{ value: boolean }>;
  launchIntent(options: {
    url: string;
    package?: string;
    chooserTitle?: string;
    requireApp?: boolean;
  }): Promise<{ completed: boolean }>;
}

function plugin(): ExternalIntentPlugin | undefined {
  const bridge = (globalThis as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
  return bridge?.Plugins?.ExternalIntent as ExternalIntentPlugin | undefined;
}

/** Is the target store app installed and resolvable for this URL? */
export async function canResolve(url: string, packageName?: string | null): Promise<boolean> {
  if (!isNativeShell()) return false;
  const native = plugin();
  if (!native) return false;
  try {
    const result = await native.canResolve({ url, package: packageName ?? undefined });
    return Boolean(result?.value);
  } catch {
    return false;
  }
}

export interface LaunchOptions {
  /** The store's Android package, when known. */
  packageName?: string | null;
  /** Fail rather than fall back to a browser when the store app is absent. */
  requireApp?: boolean;
  /** Show a disambiguation chooser (unused for store links today). */
  chooserTitle?: string;
}

/**
 * Fire an external intent. Returns whether the launch succeeded.
 *
 * In the browser/PWA there is no intent system: falls back to a new tab
 * (noopener). In the native shell a plugin failure resolves to `false` and
 * the caller decides the degrade path (`launchStoreLink` below).
 */
export async function launchIntent(options: LaunchOptions & { url: string }): Promise<boolean> {
  if (!isNativeShell()) {
    try {
      window.open(options.url, "_blank", "noopener,noreferrer");
      return true;
    } catch {
      return false;
    }
  }
  const native = plugin();
  if (!native) return false;
  try {
    const result = await native.launchIntent({
      url: options.url,
      package: options.packageName ?? undefined,
      chooserTitle: options.chooserTitle,
      requireApp: options.requireApp,
    });
    return Boolean(result?.completed);
  } catch {
    return false;
  }
}

/**
 * The one launch ladder for every "open this store" tap (Feature A cards,
 * Feature B buy rows):
 *
 *   1. explicit intent at the store's package (FLAG_ACTIVITY_REQUIRE_NON_BROWSER)
 *   2. implicit BROWSABLE intent (App Links decide app vs browser)
 *   3. native: Chrome Custom Tab · browser: new tab
 *
 * Each rung is a user gesture by construction — this is never called from a
 * render effect.
 */
export async function launchStoreLink(
  url: string,
  options: { packageName?: string | null } = {},
): Promise<boolean> {
  if (!isNativeShell()) {
    try {
      window.open(url, "_blank", "noopener,noreferrer");
      return true;
    } catch {
      return false;
    }
  }
  // 1. Explicit — the strongest signal: only the store app may answer.
  if (
    await launchIntent({
      url,
      packageName: options.packageName ?? null,
      requireApp: true,
    })
  ) {
    return true;
  }
  // 2. Implicit — App Links route to whichever app Google verified.
  if (await launchIntent({ url, packageName: null })) {
    return true;
  }
  // 3. Custom Tab — never a raw WebView of someone else's checkout.
  try {
    await Browser.open({ url });
    return true;
  } catch {
    return false;
  }
}
