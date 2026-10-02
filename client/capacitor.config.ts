import type { CapacitorConfig } from "@capacitor/cli";

// Thin wrapper: the app is served by the Audiobook Manager server itself
// (single origin), so the wrapper points at that URL. To produce an APK you
// need, on a machine with the Android SDK:
//   npm i @capacitor/core @capacitor/cli @capacitor/android
//   npx cap add android
//   npx cap sync
//   npx cap build android
const config: CapacitorConfig = {
  appId: "com.technative.audiobookmanager",
  appName: "Audiobooks",
  webDir: "dist",
  server: {
    url: process.env.CAP_SERVER_URL || "http://localhost:3000",
    cleartext: true,
  },
};

export default config;
