/**
 * Android-native OAuth glue (spec 32 / ADR 030).
 *
 * ## Why this exists at all
 *
 * The WebView cannot authorise anyone at the provider: Google blocks embedded
 * user-agents outright, and the session cookie the server sets for the browser
 * never reaches the native client anyway. So the Android app hands the whole
 * consent page to **Chrome Custom Tabs** (via `@capacitor/browser`) and gets the
 * answer back as a deep link on a private-use scheme (via `@capacitor/app`).
 *
 * Google/GitHub redirect the Custom Tab to
 * `com.technative.audiobookmanager://oauth/callback?code=…&state=…`, which the
 * OS routes back into the running app. The flow then settles here:
 *
 *  1. `beginNativeOAuth(provider)` — generate the 128-bit in-memory `state`,
 *     open the configured server's `/api/auth/:provider/authorize?client=native`
 *     in a Custom Tab. The state lives only in module memory; never persisted.
 *  2. `handleOAuthDeepLink(url)` — match scheme/host/path, compare `state` to
 *     the in-flight one (anything else: ignored, zero API calls, RFC 8252 §8.9),
 *     exchange the one-time code at `POST /api/auth/oauth/handoff`, and hand
 *     the result to subscribers.
 *  3. The account gate subscribes and completes the same finish path the
 *     password login uses.
 *
 * The `pending` slot bridges two awkward moments: a result that resolves while
 * the gate is not mounted (process was killed mid-flow; cold start, user still
 * sees the splash) and a gate that unmounts/remounts during a probe flip. A
 * stale parked result is discarded the moment a *new* flow begins.
 *
 * This module is deliberately inert in browsers: registration checks
 * `isNativeShell()` at import time, and `beginNativeOAuth` throws otherwise.
 * The web path keeps its `window.location.href` behaviour untouched.
 */
import { App, type URLOpenListenerEvent } from "@capacitor/app";
import { Browser } from "@capacitor/browser";

import { apiUrl } from "./api";
import { isNativeShell } from "./platform";
import { fetchWithDeadline, REQUEST_TIMEOUT_MS } from "./bounded";

/** The private-use scheme this app owns (AndroidManifest intent-filter). */
export const NATIVE_OAUTH_SCHEME = "com.technative.audiobookmanager";
/** The deep link the server redirects to: scheme://oauth/callback (host "oauth", path "/callback"). */
export const NATIVE_OAUTH_HOST = "oauth";
export const NATIVE_OAUTH_CALLBACK_PATH = "/callback";

/** 128-bit `state`, base64url, held in memory only. */
const OAUTH_STATE_BYTES = 16;

export type NativeOAuthResult =
  | { kind: "ok"; token: string; profileId: number | null }
  | { kind: "error"; code: string };

interface InflightOAuth {
  provider: "google" | "github";
  state: string;
}

let inflight: InflightOAuth | null = null;
/** A resolved result parked until a subscriber (or the splash, at cold start) takes it. */
let pending: NativeOAuthResult | null = null;
const listeners = new Set<(result: NativeOAuthResult) => void>();
let listenerRegistered = false;

/** Test seam: drop every bit of module state. */
export function resetNativeOAuthState(): void {
  inflight = null;
  pending = null;
  listeners.clear();
  listenerRegistered = false;
}

/** Subscribe to the outcome of the in-flight native OAuth flow. Replays a parked result once. */
export function subscribeNativeOAuth(
  listener: (result: NativeOAuthResult) => void,
): () => void {
  listeners.add(listener);
  if (pending) {
    const parked = pending;
    pending = null;
    listener(parked);
  }
  return () => {
    listeners.delete(listener);
  };
}

function publish(result: NativeOAuthResult): void {
  if (listeners.size === 0) {
    pending = result;
    return;
  }
  for (const listener of [...listeners]) listener(result);
}

function randomBase64Url(bytes: number): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new Error("crypto.getRandomValues is unavailable in this runtime");
  }
  const buffer = new Uint8Array(bytes);
  cryptoApi.getRandomValues(buffer);
  let binary = "";
  for (const byte of buffer) binary += String.fromCharCode(byte);
  const b64 = typeof btoa === "function" ? btoa(binary) : Buffer.from(buffer).toString("base64");
  return b64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function isOAuthCallback(parsed: URL): boolean {
  return (
    parsed.protocol === `${NATIVE_OAUTH_SCHEME}:` &&
    parsed.host === NATIVE_OAUTH_HOST &&
    parsed.pathname === NATIVE_OAUTH_CALLBACK_PATH
  );
}

/**
 * Open the Custom Tab at the server's authorize endpoint.
 *
 * The state is discarded with the flow, never persisted; a re-begin clears any
 * stale parked result.
 */
export async function beginNativeOAuth(provider: "google" | "github"): Promise<void> {
  if (!isNativeShell()) {
    throw new Error("native OAuth requires the Android shell");
  }
  const state = randomBase64Url(OAUTH_STATE_BYTES);
  inflight = { provider, state };
  // A fresh intent invalidates whatever result an earlier, abandoned flow parked.
  pending = null;
  await Browser.open({
    url: apiUrl(`/api/auth/${provider}/authorize?client=native&state=${state}`),
  });
}

/**
 * Handle a deep link the OS routed into this app.
 *
 * Everything that is not our exact scheme/host/path is ignored so the system
 * can keep delivering other links; confirming the in-flight `state` is the
 * RFC 8252 §8.9 cross-app request-forgery check. Any failure to exchange the
 * code yields `{ kind: "error", code: "oauth_handoff_invalid" }` — the client
 * maps unknown/handoff codes to the reviewed generic sentence.
 */
export async function handleOAuthDeepLink(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (!isOAuthCallback(parsed)) return;

  // The Custom Tab has served its purpose once a callback arrives.
  try {
    await Browser.close();
  } catch {
    /* best effort; the app still works */
  }

  const inFlight = inflight;
  if (!inFlight) return;
  inflight = null;

  const authError = parsed.searchParams.get("auth_error");
  if (authError) {
    publish({ kind: "error", code: authError });
    return;
  }
  const code = parsed.searchParams.get("code");
  const state = parsed.searchParams.get("state");
  if (state !== inFlight.state) {
    publish({ kind: "error", code: "oauth_state_mismatch" });
    return;
  }
  if (!code) {
    publish({ kind: "error", code: "oauth_handoff_invalid" });
    return;
  }

  try {
    const response = await fetchWithDeadline(
      apiUrl("/api/auth/oauth/handoff"),
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, state }),
      },
      REQUEST_TIMEOUT_MS,
    );
    if (!response.ok) {
      publish({ kind: "error", code: "oauth_handoff_invalid" });
      return;
    }
    const body = (await response.json()) as {
      token?: string;
      profile?: { id?: number } | null;
    };
    if (!body.token) {
      publish({ kind: "error", code: "oauth_handoff_invalid" });
      return;
    }
    publish({
      kind: "ok",
      token: body.token,
      profileId: body.profile && typeof body.profile.id === "number" ? body.profile.id : null,
    });
  } catch {
    publish({ kind: "error", code: "oauth_handoff_invalid" });
  }
}

/**
 * Register the OS-level deep-link listeners.
 *
 * Runs at module import on the native shell so a cold-started process catches
 * the link before React finishes mounting; `getLaunchUrl()` covers the
 * returning-from-kill case, `appUrlOpen` the warm case.
 */
export function registerNativeOAuthListener(): void {
  if (!isNativeShell() || listenerRegistered) return;
  listenerRegistered = true;

  void (async () => {
    try {
      const launched = await App.getLaunchUrl();
      if (launched?.url) await handleOAuthDeepLink(launched.url);
    } catch {
      /* best effort: without it, a cold-started native flow just shows the sign-in screen */
    }
  })();

  void App.addListener("appUrlOpen", (event: URLOpenListenerEvent) => {
    void handleOAuthDeepLink(event.url);
  }).catch(() => {
    /* the buttons simply cannot work without this; nothing here is worth crashing the app over */
  });
}

if (typeof window !== "undefined") {
  registerNativeOAuthListener();
}
