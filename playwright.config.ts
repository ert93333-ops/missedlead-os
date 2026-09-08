import { defineConfig, devices } from '@playwright/test'

const useExternalServer = process.env.PLAYWRIGHT_EXTERNAL_SERVER === '1'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 300_000,
  workers: 1,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5191',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: useExternalServer ? undefined : {
    command: 'pnpm exec vite --host 127.0.0.1 --port 5191',
    url: 'http://127.0.0.1:5191',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
