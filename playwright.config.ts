import { defineConfig, devices } from '@playwright/test'

// C5 prerequisites: public Supabase URL/key + service key in the process env,
// then `node scripts/seed-load.mjs`. No secrets or sessions are written to disk.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000'

export default defineConfig({
  testDir: './e2e',
  // e2e/spikes/** holds one-off spike specs (e.g. cheerpj.spec.ts) that are not
  // part of the normal suite. Playwright applies testIgnore at discovery time,
  // before CLI file-path filtering, so an excluded file can't be re-included by
  // naming it on the command line - RUN_SPIKES=1 lifts the exclusion instead:
  //   RUN_SPIKES=1 npx playwright test e2e/spikes/cheerpj.spec.ts --config playwright.config.ts
  // The whole-Java-bank certification run is excluded the same way (it compiles
  // every reference solution in a real browser and takes minutes):
  //   RUN_JAVA_BANK=1 npx playwright test e2e/java/verify-java-bank.spec.ts --project=chromium
  testIgnore: [
    ...(process.env.RUN_SPIKES ? [] : ['**/spikes/**']),
    ...(process.env.RUN_JAVA_BANK ? [] : ['**/verify-java-bank.spec.ts']),
  ],
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
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3000',
    url: `${baseURL}/login`,
    env: { AGENT_DRY_RUN: 'true' },
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
