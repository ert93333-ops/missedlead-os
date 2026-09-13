import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
const apiTarget = process.env.WECOVER_API_URL ?? 'http://127.0.0.1:8787'

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/api': apiTarget,
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 5195,
    strictPort: true,
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/api': apiTarget,
    },
  },
})
