import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor config for the Android app (specs/26-android-app.md).
 *
 * ## No `server.url`
 *
 * An earlier version hardcoded `url: "http://localhost:3000"` on the theory
 * that the wrapper would just display the server. That is wrong on a phone:
 * `localhost` is the *phone*, not the home server, so the app loads nothing and
 * shows an error page. Removing it makes Capacitor serve the bundled web assets
 * from its own local scheme instead, which is what an offline app must do.
 *
 * Pointing at a real server is a Phase 4 concern, and it belongs in an in-app
 * setting rather than baked into a build.
 */
const config: CapacitorConfig = {
  appId: "com.technative.audiobookmanager",
  appName: "Audiobooks",
  webDir: "dist",
  server: {
    /**
     * The app is served from `http://localhost`, not `https://localhost`.
     *
     * This is the fix for the LAN-reachability failure in LIMITATIONS 1.6, and
     * it is a mixed-content fix, not a networking one.
     *
     * Capacitor's default scheme is `https`, which makes the app page a secure
     * context. Every request it then makes to the home server is plain HTTP,
     * so the renderer treats it as **mixed content** and blocks it before a
     * single packet leaves the device. Measured on a Pixel 4a with WebView 154:
     *
     *   http://localhost:3000     -> 200 in 40ms   (localhost is exempt)
     *   http://192.168.1.203:3311 -> fails in 1ms  (blocked as mixed content)
     *
     * Everything else was already healthy and is deliberately *not* changed:
     * the phone pings the host at 0% loss, the host serves 200 on the same port,
     * the phone's own OS stack gets 200 over `nc`, the CORS preflight returns
     * 204, and `network_security_config.xml` already sets
     * `cleartextTrafficPermitted="true"`.
     *
     * That is why this looked like a firewall, a port or a CORS problem, and
     * why none of those turned out to be it.
     *
     * The trade: the app's own origin is no longer a secure context. It serves
     * bundled local assets and nothing else, and every request it makes still
     * goes to the address the user typed, over a home LAN -- which is the same
     * trust boundary `network_security_config.xml` already documents, with the
     * same reasoning. See `decisions/014-webview-http-scheme.md`.
     *
     * Consequence to expect: the origin changes from `https://localhost` to
     * `http://localhost`, so localStorage is a different origin. The app looks
     * like a fresh install and shows the server-URL screen once.
     */
    androidScheme: "http",

    /**
     * The home server is plain HTTP on the LAN. Without this, every API request
     * is blocked -- Chromium reported it as
     *
     *   "Access to fetch at 'http://.../api/health' from origin
     *    'https://localhost' has been blocked by CORS policy"
     *
     * Note this is a *different* switch from the network security config in
     * AndroidManifest.xml. That one governs native HTTP (the Filesystem
     * plugin's downloads); this one governs the WebView. Both are needed, and
     * turning on only one produces a confusing half-working app.
     *
     * See LIMITATIONS.md: this is security debt, acceptable only while the app
     * is used on a trusted home LAN.
     */
    cleartext: true,
  },
  plugins: {
    MediaSession: {
      // The plugin defaults to starting its foreground service only once
      // playback turns active. That races the first `setPlaybackState("playing")`
      // call from the web layer, and the service never starts, so Android shows
      // no media notification and no lock-screen controls -- the exact gap the
      // first spike run hit. Starting it up front removes the race.
      foregroundService: "always",
    },
  },
};

export default config;