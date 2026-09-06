import { test, expect } from '@playwright/test'

// Spike: does CheerpJ 4.3 compile and run real Java in the browser well enough
// to replace Judge0? See docs/research/java-without-judge.md (recommendation)
// and docs/research/cheerpj-spike.md (this spec's results). Not part of the
// normal suite: playwright.config.ts testIgnore excludes e2e/spikes/**, so run
// this file explicitly:
//   npx playwright test e2e/spikes/cheerpj.spec.ts --config playwright.config.ts
//
// This asserts nothing about pass/fail correctness beyond "the page reported" -
// the point of this spec is to produce timing and size data, not a red/green gate.

interface SpikeResult {
  compileMs: number | null
  initMs: number | null
  totalMs: number | null
  tests: Array<{ id: string; passed: boolean; actual: string; expected: string; runMs: number }>
  errors: string[]
  done: boolean
}

declare global {
  interface Window {
    __spike?: SpikeResult
  }
}

test.setTimeout(5 * 60 * 1000)

async function runOnce(page: import('@playwright/test').Page, label: string) {
  const responses: Array<{ url: string; bytes: number }> = []
  const consoleLines: string[] = []

  page.on('console', (msg) => {
    consoleLines.push(`[${msg.type()}] ${msg.text()}`)
  })
  page.on('pageerror', (err) => {
    consoleLines.push(`[pageerror] ${err.message}`)
  })
  page.on('response', (response) => {
    responses.push({ url: response.url(), bytes: 0 })
    const idx = responses.length - 1
    response
      .body()
      .then((buf) => {
        responses[idx].bytes = buf.length
      })
      .catch(() => {
        // Opaque/redirect/streamed responses can fail to buffer; fall back to the
        // content-length header when the body isn't retrievable.
        const len = response.headers()['content-length']
        responses[idx].bytes = len ? Number(len) : 0
      })
  })

  await page.goto('/spikes/cheerpj/index.html')

  await page.waitForFunction(() => window.__spike?.done === true, { timeout: 5 * 60 * 1000 })
  // Let in-flight response.body() promises above settle before reading sizes.
  await page.waitForTimeout(500)

  const spike = (await page.evaluate(() => window.__spike)) as SpikeResult

  const cheerpjBytes = responses
    .filter((r) => r.url.includes('cjrtnc.leaningtech.com'))
    .reduce((sum, r) => sum + r.bytes, 0)
  const toolsJarBytes = responses
    .filter((r) => r.url.includes('/spikes/cheerpj/tools.jar'))
    .reduce((sum, r) => sum + r.bytes, 0)
  const totalBytes = responses.reduce((sum, r) => sum + r.bytes, 0)

  console.log(`\n===== CheerpJ spike: ${label} =====`)
  console.log(`init ms: ${spike?.initMs}`)
  console.log(`compile ms: ${spike?.compileMs}`)
  console.log(`total ms: ${spike?.totalMs}`)
  console.log(`tests: ${JSON.stringify(spike?.tests, null, 2)}`)
  console.log(`pass count: ${spike?.tests?.filter((t) => t.passed).length ?? 0} / ${spike?.tests?.length ?? 0}`)
  console.log(`errors: ${JSON.stringify(spike?.errors, null, 2)}`)
  console.log(`network responses: ${responses.length}`)
  console.log(`CheerpJ runtime bytes (cjrtnc.leaningtech.com): ${cheerpjBytes}`)
  console.log(`tools.jar bytes (our origin): ${toolsJarBytes}`)
  console.log(`total transferred bytes: ${totalBytes}`)
  console.log('--- browser console ---')
  console.log(consoleLines.join('\n'))
  console.log('===== end =====\n')

  return { spike, cheerpjBytes, toolsJarBytes, totalBytes, responseCount: responses.length }
}

test('CheerpJ compiles and runs the "Shapes report" Java exercise in the browser', async ({ page }) => {
  const cold = await runOnce(page, 'first load (cold cache)')
  expect(cold.spike?.done).toBe(true)

  const warm = await runOnce(page, 'second load (warm cache)')
  expect(warm.spike?.done).toBe(true)

  console.log('\n===== summary =====')
  console.log(`cold total bytes: ${cold.totalBytes}, warm total bytes: ${warm.totalBytes}`)
  console.log(`cold init ms: ${cold.spike?.initMs}, warm init ms: ${warm.spike?.initMs}`)
  console.log(`cold compile ms: ${cold.spike?.compileMs}, warm compile ms: ${warm.spike?.compileMs}`)
})
