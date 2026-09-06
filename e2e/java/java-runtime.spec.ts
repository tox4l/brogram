import { test, expect } from '@playwright/test'
import { javaVerifyResult, type JavaVerify } from './support'

/**
 * The browser Java runtime end to end: a real Worker, the CheerpJ runtime from
 * the vendor CDN, tools.jar from this origin, and javac compiling the "Shapes
 * report" reference before it is graded. Runs against the development-only
 * page src/app/preview/java-verify/page.tsx, so it needs no Supabase session.
 *
 * Part of the default suite. The whole-bank run is e2e/java/verify-java-bank.spec.ts.
 */

// A cold first load pulls ~18 MB of CheerpJ runtime plus the compiler classes.
test.setTimeout(5 * 60 * 1000)

test('compiles and grades a Java exercise in the browser, and reports a compile error', async ({ page }) => {
  const verify: JavaVerify = await javaVerifyResult(page, '/preview/java-verify?only=smoke')

  expect(verify.error).toBeNull()
  expect(verify.rows).toHaveLength(1)
  const shapes = verify.rows[0]
  console.log(`Shapes report: ${shapes.passed}/${shapes.total} in ${shapes.ms} ms`)
  expect(shapes.failures, JSON.stringify(shapes.failures)).toEqual([])
  expect(shapes.passed).toBe(5)
  expect(shapes.total).toBe(5)

  // Broken source must come back as a compile error carrying javac's own text,
  // never as a wrong answer.
  expect(verify.compileError?.failureKind).toBe('compile-error')
  expect(verify.compileError?.stderr).toContain('error:')
})
