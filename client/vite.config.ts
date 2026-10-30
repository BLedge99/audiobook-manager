import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
//
// `vite build --mode android` (npm run build:android) drops the service worker
// for the Capacitor build. Keyed off the mode rather than an env var so it
// behaves the same on Windows, in WSL and in CI without a cross-env dependency.
//
// The PWA service worker is for the *browser* PWA only.
//
// In the Android shell it is actively harmful. Assets are bundled into the APK
// and served locally, so there is nothing for it to cache for offline use --
// and worse, it caches the app shell itself and keeps serving the *previous*
// bundle after the app is updated. That was observed directly: an APK rebuilt
// with a component deleted still ran the deleted component, with no error
// anywhere in logcat. Silent stale code is worse than a slow first paint, and
// because the WebView survives an APK update it would persist until the app's
// data was cleared.
export default defineConfig(({ mode }) => ({
  // The build's own timestamp, so the app can say which build is installed.
  //
  // `versionName` is 1.0 in every APK, so the phone cannot tell you whether
  // it is running the build you just made or the one from last week -- and
  // "did my change take?" is a question worth being able to answer on the
  // device itself.
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    tailwindcss(),
    ...(mode === 'android'
      ? []
      : [
          VitePWA({
            registerType: 'autoUpdate',
            devOptions: { enabled: true, type: 'module' },
            manifest: {
              name: 'Audiobook Manager',
              short_name: 'Audiobooks',
              description: 'Your household audiobook library',
              // The machine's own ground, not the old slate. Kept in step with
              // --ground in src/index.css; index.html carries the per-scheme
              // <meta name="theme-color"> for the Android status bar.
              theme_color: '#f4f2f5',
              background_color: '#f4f2f5',
              display: 'standalone',
              icons: [
                { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
              ],
            },
            workbox: {
              navigateFallback: '/index.html',
              runtimeCaching: [
                { urlPattern: /^\/api\//, handler: 'NetworkOnly' },
              ],
            },
          }) as PluginOption,
        ]),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    pool: 'threads',
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://server:3000',
        changeOrigin: true,
      },
    },
  },
}))