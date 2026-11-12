/**
 * The public privacy notice lives on the server at `GET /privacy`
 * (specs/GDPR-privacy-notice.md). No session is required — that is the point of
 * it — so it can be linked from the sign-in gate before any personal data is
 * collected.
 *
 * On the web a plain anchor to the resolved URL is enough: the browser is
 * same-origin with the API (Vite proxy in dev, reverse proxy in production).
 *
 * The native shell is a different world. Its origin is `https://localhost`, so
 * a root-relative `href="/privacy"` resolves against the *phone*, not the
 * configured server — the link led nowhere. Even an absolute plain-HTTP LAN
 * URL is awkward from an HTTPS WebView and is better handled the way the app
 * already handles the OAuth consent page: Chrome Custom Tabs, via
 * `@capacitor/browser` (see `lib/oauthNative.ts`).
 */
import { Browser } from "@capacitor/browser";
import { apiUrl, hasServerUrl } from "./api";
import { isNativeShell } from "./platform";

/** Where the notice for the configured server lives. */
export function privacyNoticeUrl(): string {
  return apiUrl("/privacy");
}

/**
 * True when there is a URL worth offering.
 *
 * The browser can always offer one (apiUrl falls back to the relative path).
 * The native shell cannot when no server is configured yet: `apiUrl` would
 * return the unusable "/privacy", and a link to a page that cannot exist on
 * the phone is exactly the dead link this module exists to kill. The
 * first-run ServerSetup screen — which is what renders in that state — has
 * its own wording, so the gate renders nothing instead of a dead end.
 */
export function canOpenPrivacyNotice(): boolean {
  if (!isNativeShell()) return true;
  return hasServerUrl();
}

/**
 * Open the notice.
 *
 * Web: let the anchor navigate (this function is not called by the click
 * handler on the web). Native: open a Custom Tab. If Custom Tabs are somehow
 * unavailable, fall back to `window.open` and swallow the failure — the
 * alternative is a silent no-op, which is what made this bug invisible.
 */
export async function openPrivacyNotice(): Promise<void> {
  const url = privacyNoticeUrl();
  try {
    await Browser.open({ url });
  } catch {
    try {
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      // No opener and no Custom Tab handler. Nothing else to try.
    }
  }
}

/**
 * Click handler for privacy-notice anchors.
 *
 * The web path is the anchor's native navigation; this handler only
 * intervenes in the native shell, where it suppresses the navigation and
 * opens Custom Tabs instead.
 */
export function onPrivacyNoticeClick(event: { preventDefault(): void }): void {
  if (!isNativeShell()) return;
  if (!canOpenPrivacyNotice()) {
    event.preventDefault();
    return;
  }
  event.preventDefault();
  void openPrivacyNotice();
}
