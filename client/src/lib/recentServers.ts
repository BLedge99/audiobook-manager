/**
 * Recent servers (spec 40).
 *
 * A short, device-local list of server addresses whose health check has
 * succeeded, so switching back to a past server is one tap in Settings.
 *
 * ## Why a list and not a history
 *
 * The value is *switching*, not auditing. Five entries, most recently
 * confirmed first, is all anyone needs — and all they should get on a phone
 * screen.
 *
 * ## Why the entries are normalised URLs
 *
 * `normaliseServerUrl` is the same repair `serverUrl` itself gets, so two
 * spellings of one server (`your-server:3000/` and `http://your-server:3000`)
 * are the same entry. The normalised URL is also the local server identity
 * used by the per-server offline shelves (spec 30), so list entries match
 * those shelves key-for-key without a second notion of "which server this is".
 *
 * ## Why storing failures is never fatal
 *
 * This is a convenience on top of a working app. Private mode, a full quota,
 * or hand-edited JSON must not break the Settings panel — every read degrades
 * to an empty list, every write degrades to "nothing changed".
 */

import { normaliseServerUrl } from "./api";

export const RECENT_SERVERS_KEY = "recentServers";
/** Most recently confirmed first. Five fits a phone screen without scrolling. */
export const RECENT_SERVERS_MAX = 5;

function readRaw(): unknown {
  if (typeof window === "undefined") return null;
  try {
    const text = window.localStorage.getItem(RECENT_SERVERS_KEY);
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function writeRaw(urls: string[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(RECENT_SERVERS_KEY, JSON.stringify(urls));
    return true;
  } catch {
    return false;
  }
}

/**
 * The stored list, cleaned: normalised, de-duplicated (first occurrence
 * wins), capped. Anything unreadable or unusable degrades toward an empty
 * list rather than throwing.
 */
export function listRecentServers(): string[] {
  const raw = readRaw();
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const url = normaliseServerUrl(entry);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
    if (urls.length >= RECENT_SERVERS_MAX) break;
  }
  return urls;
}

/**
 * Record a confirmed address: move it to the front, or add it, and cap the
 * list. Entries that normalise to nothing are ignored. Returns the list as
 * it stands afterwards (unchanged when the write fails).
 */
export function recordRecentServer(url: string): string[] {
  const normalised = normaliseServerUrl(url);
  if (!normalised) return listRecentServers();
  const next = [normalised, ...listRecentServers().filter((existing) => existing !== normalised)]
    .slice(0, RECENT_SERVERS_MAX);
  return writeRaw(next) ? next : listRecentServers();
}

/**
 * Add an address only if the list does not already hold it. Used to seed the
 * currently configured server on opening Settings, so a server set before
 * this feature shipped still shows up. Idempotent.
 */
export function ensureRecentServer(url: string): string[] {
  const normalised = normaliseServerUrl(url);
  if (!normalised) return listRecentServers();
  const current = listRecentServers();
  if (current.includes(normalised)) return current;
  return recordRecentServer(normalised);
}

/**
 * Forget one entry. Only the list changes — the configured server and every
 * per-server artefact (downloads, replica rows, covers) are untouched.
 */
export function removeRecentServer(url: string): string[] {
  const normalised = normaliseServerUrl(url);
  const next = listRecentServers().filter((existing) => existing !== normalised);
  return writeRaw(next) ? next : listRecentServers();
}
