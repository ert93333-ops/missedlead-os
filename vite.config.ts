import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = process.env.WECOVER_API_URL ?? 'http://127.0.0.1:8787'
  // Same-origin proxy for the client's Supabase stack so public preview/tunnel
  // origins can reach it without baking loopback URLs into the client. Prefer
  // VITE_SUPABASE_URL — the URL actually baked into the bundle.
  const supaTarget = env.VITE_SUPABASE_URL || env.SUPABASE_URL || 'http://127.0.0.1:56321'
  const supaProxy = {
    target: supaTarget,
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/supa/, ''),
  }

  return {
    plugins: [react()],
    server: {
      allowedHosts: ['.trycloudflare.com'],
      proxy: {
        '/api': apiTarget,
        '/supa': supaProxy,
      },
    },
    preview: {
      host: '127.0.0.1',
      port: 5195,
      strictPort: true,
      allowedHosts: ['.trycloudflare.com'],
      proxy: {
        '/api': apiTarget,
        '/supa': supaProxy,
      },
    },
  }
})
