import { test, expect } from '@playwright/test'
import { javaVerifyResult, readJavaBank, type JavaVerify } from './support'

/**
 * The browser Java runtime end to end: a real Worker, the CheerpJ runtime from
 * the vendor CDN, tools.jar from this origin, and javac compiling the "Shapes
 * report" reference before it is graded. Runs against the development-only
 * page src/app/preview/java-verify/page.tsx, so it needs no Supabase session.
 *
 * Excluded from the default suite (playwright.config.ts testIgnore) because it
 * depends on a third-party CDN and on public/java/tools.jar, which is
 * gitignored and fetched at install time. Run it with:
 *   RUN_JAVA_E2E=1 npx playwright test e2e/java/java-runtime.spec.ts --project=chromium
 * The whole-bank run is e2e/java/verify-java-bank.spec.ts.
 */

// A cold first load pulls ~18 MB of CheerpJ runtime plus the compiler classes.
test.setTimeout(5 * 60 * 1000)

test('compiles and grades a Java exercise in the browser, and reports a compile error', async ({ page }) => {
  const verify: JavaVerify = await javaVerifyResult(page, readJavaBank('smoke.json'))

  expect(verify.error).toBeNull()
  expect(verify.rows).toHaveLength(1)
  const shapes = verify.rows[0]
  console.log(`Shapes report: ${shapes.passed}/${shapes.total} in ${shapes.ms} ms`)
  expect(shapes.failures, JSON.stringify(shapes.failures)).toEqual([])
  expect(shapes.passed).toBe(5)
  expect(shapes.total).toBe(5)

  // Broken source must come back as a compile error carrying javac's own text,
  // never as a wrong answer - and pointing at the file the student edits.
  expect(verify.compileError?.failureKind).toBe('compile-error')
  expect(verify.compileError?.stderr).toContain('error:')
  expect(verify.compileError?.stderr).toContain('Solution.java:')
})
