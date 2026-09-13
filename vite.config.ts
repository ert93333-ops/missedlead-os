/**
 * Vite 설정: React 플러그인, /api 프록시(WECOVER_API_URL로 변경 가능),
 * /supa same-origin Supabase 프록시(터널 등 공개 호스트 대응), trycloudflare 호스트 허용.
 */
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
