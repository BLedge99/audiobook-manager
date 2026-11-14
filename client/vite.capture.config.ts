// Lab-only capture config (design-lab): vite preview with /api proxied
// straight at the dockerised server over WSL's host IP, bypassing the flaky
// Windows→WSL relay for 5173. NOT committed; deleted once captures done.
import base from './vite.config'
import { defineConfig, mergeConfig } from 'vite'

export default mergeConfig(
  base({ mode: 'production', command: 'serve' }),
  defineConfig({
    preview: {
      port: 4174,
      proxy: {
        '/api': {
          target: 'http://192.168.129.230:3001',
          changeOrigin: true,
        },
      },
    },
  }),
)
