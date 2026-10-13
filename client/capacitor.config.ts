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
     * The home server is plain HTTP on the LAN, and the WebView loads the app
     * from an `https://localhost` origin. Without this, every API request is
     * blocked as mixed content -- Chromium reported it as
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