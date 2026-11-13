/**
 * Cache headers for the built client, shared by the family and admin static
 * listeners. Vite emits content-hashed filenames under /assets, so those can
 * be immutable for a year; the shell must always revalidate or a stale
 * index.html pins installed apps to an old bundle. Stable root files (fonts,
 * icons) get a day.
 */
export function cacheControlForPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.endsWith("/index.html")) return "public, max-age=0, must-revalidate";
  if (/\/assets\//.test(normalized)) return "public, max-age=31536000, immutable";
  return "public, max-age=86400";
}

/** Missing JS/CSS/assets must 404 loudly, never fall through to the shell. */
export function isAssetRequest(url: string): boolean {
  const path = url.split("?")[0].replace(/\\/g, "/");
  return /\.(js|mjs|css|map|png|jpe?g|svg|webp|ico|woff2?)$/i.test(path) || path.startsWith("/assets/") || path.startsWith("/fonts/");
}
