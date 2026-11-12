/**
 * Route media loads through the app's own origin instead of an absolute
 * http(s) URL.
 *
 * ## Why
 *
 * The Android WebView serves the app from `https://localhost`, which makes
 * the page a secure context. Chrome auto-upgrades *passive* mixed content
 * (audio/video/img) from http to https, and the household LAN server has no
 * TLS -- so the upgrade fails and the media element fires `error` immediately.
 * `fetch()` is active mixed content and is whitelisted by
 * `android.allowMixedContent`, which is why the rest of the app works over
 * plain http while the media element does not.
 *
 * Instead of teaching the element to tolerate http, give it a same-origin
 * URL. The native side (`MediaProxyWebViewClient`) fulfils it by fetching
 * the real URL with a native HTTP client (Range requests included) and
 * streaming the response back. See ADR 031 and
 * `docs/android-remote-playback-media-proxy-plan.md`.
 *
 * The media-token query string (when there is one) rides inside `url`, so it
 * never needs special handling here.
 */
export const MEDIA_PROXY_PREFIX = "https://localhost/_media?url=";

/**
 * Wrap `absoluteUrl` in the app-origin media proxy.
 *
 * Anything that is not an absolute http(s) URL is returned unchanged: the
 * element already knows how to load `capacitor-file://`, `blob:`, data URIs
 * and relative paths, and the native layer can only proxy http(s) anyway.
 */
export function mediaProxyUrl(absoluteUrl: string): string {
  if (!/^https?:\/\//i.test(absoluteUrl)) return absoluteUrl;
  return `${MEDIA_PROXY_PREFIX}${encodeURIComponent(absoluteUrl)}`;
}
