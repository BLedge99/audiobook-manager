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
  android: {
    /**
     * Keep Capacitor's default `https://localhost` origin so existing
     * localStorage and IndexedDB data remains available across app updates.
     * The phone must still call the user-configured plain-HTTP home server;
     * this allows those mixed-scheme requests in the WebView.
     *
     * This is a security trade-off: use only with the trusted home-LAN server.
     * Prefer an HTTPS server if the app is exposed beyond that network.
     */
    allowMixedContent: true,
  },
  server: {
    /**
     * The home server is plain HTTP on the LAN. Without this, every API request
     * is blocked by Android's native network security policy. This is separate
     * from `android.allowMixedContent`, which controls the WebView renderer.
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