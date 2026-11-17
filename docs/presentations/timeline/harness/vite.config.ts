import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Era capture harness: renders a historical client/src tree with canned API
// data, no server required. See docs/presentations/timeline (or the deck) for
// usage. Not part of any build.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 4560, strictPort: true },
  build: { target: 'es2022', outDir: 'dist' },
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
})
