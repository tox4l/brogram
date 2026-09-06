import { defineConfig, devices } from '@playwright/test'

// C5 prerequisites: public Supabase URL/key + service key in the process env,
// then `node scripts/seed-load.mjs`. No secrets or sessions are written to disk.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL, trace: 'off', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } }],
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
    command: 'npm.cmd run dev -- --hostname 127.0.0.1 --port 3000',
    url: `${baseURL}/login`,
    env: { AGENT_DRY_RUN: 'true' },
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
