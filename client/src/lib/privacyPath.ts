/**
 * Is this navigation for the public privacy notice? (Spec 42, phase 4.)
 *
 * The SPA has no router; the notice is a document the server also serves
 * standalone at `/privacy`. When the service worker navigates and the server
 * cannot answer, the cached application shell loads and the *app* owns the
 * URL — so the app must know the notice at this path.
 *
 * Deliberately narrow: only `/privacy` (case-insensitive, trailing slash
 * tolerated). Everything else is the application shell.
 */
export function isPrivacyPath(pathname: string | undefined): boolean {
  if (!pathname) return false;
  const normalised = pathname.replace(/\/+$/, "").toLowerCase();
  return normalised === "/privacy";
}
