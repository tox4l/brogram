import { test, expect } from '@playwright/test'
import { javaVerifyResult, type JavaVerify } from './support'

/**
 * Certifies the Java exercise bank: every reference solution in
 * seed/exercises/unverified/INFS3102.json plus smoke.json's Java exercise is
 * compiled and graded by the real browser runtime, and the result table is
 * printed. scripts/verify-exercise.mjs cannot do this - it runs in Node, where
 * there is no CheerpJ and therefore no javac.
 *
 * Not part of the default suite (playwright.config.ts testIgnore). Run it with:
 *   RUN_JAVA_BANK=1 npx playwright test e2e/java/verify-java-bank.spec.ts --project=chromium
 * Add PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 to reuse a dev server you already have.
 */

test.setTimeout(20 * 60 * 1000)

test('every Java reference solution passes its own tests in the browser', async ({ page }) => {
  const verify: JavaVerify = await javaVerifyResult(page, '/preview/java-verify')
  expect(verify.error).toBeNull()

  const width = Math.max(...verify.rows.map(row => row.title.length), 8)
  console.log('\n===== Java bank verification =====')
  console.log(`${'exercise'.padEnd(width)}  outcome     tests   ms     first failure`)
  for (const row of verify.rows) {
    const failure = row.failures[0]
    const detail = failure ? `${failure.testId}: expected ${JSON.stringify(failure.expected)} got ${JSON.stringify(failure.actual)}${failure.failureKind ? ` [${failure.failureKind}]` : ''} ${failure.stderr.split('\n')[0]}` : ''
    console.log(`${row.title.padEnd(width)}  ${row.cloId}  ${String(row.passed).padStart(2)}/${row.total}   ${String(row.ms).padStart(5)}  ${detail}`)
  }
  const green = verify.rows.filter(row => row.passed === row.total)
  console.log(`\n${green.length} of ${verify.rows.length} exercises pass every test.`)
  console.log(`green: ${green.map(row => row.title).join(' | ')}`)
  console.log(`parked: ${verify.rows.filter(row => row.passed !== row.total).map(row => row.title).join(' | ') || '(none)'}`)
  console.log('===== end =====\n')

  // The table above is the deliverable; this only guards against a harness that
  // silently ran nothing.
  expect(verify.rows.length).toBeGreaterThan(10)
})
