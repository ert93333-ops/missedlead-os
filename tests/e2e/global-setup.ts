/**
 * Playwright globalSetup: vite cold-transform을 미리 워밍해 첫 테스트 타임아웃을 방지한다.
 */
import { chromium } from '@playwright/test'

// Vite dev cold-transform can take several minutes on this host. Warm the
// module graph once before the suite so the first page test does not absorb
// the entire transform budget. Best-effort: non-dev servers without demo
// auth simply skip the wait.
export default async function globalSetup() {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5191'
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.goto(`${baseURL}/`, { waitUntil: 'commit', timeout: 300_000 })
    await page.getByTestId('demo-actor-selector').waitFor({ timeout: 900_000 }).catch(() => undefined)
  } finally {
    await browser.close()
  }
}
