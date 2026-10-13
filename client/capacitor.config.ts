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