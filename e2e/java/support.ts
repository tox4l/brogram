import type { Page } from '@playwright/test'

export interface JavaVerifyFailure { testId: string; expected: string; actual: string; stderr: string; failureKind?: string }
export interface JavaVerifyRow { file: string; title: string; cloId: string; pattern: string; passed: number; total: number; ms: number; failures: JavaVerifyFailure[] }
export interface JavaVerify { rows: JavaVerifyRow[]; compileError: { failureKind?: string; stderr: string } | null; done: boolean; error: string | null }

declare global {
  interface Window { __javaVerify?: JavaVerify }
}

/** Opens the development-only Java harness and waits for it to finish. */
export async function javaVerifyResult(page: Page, url: string, timeout = 15 * 60 * 1000): Promise<JavaVerify> {
  page.on('console', message => { if (message.type() === 'error') console.log(`[browser error] ${message.text()}`) })
  page.on('pageerror', error => console.log(`[pageerror] ${error.message}`))
  await page.goto(url)
  await page.waitForFunction(() => window.__javaVerify?.done === true, { timeout })
  return (await page.evaluate(() => window.__javaVerify)) as JavaVerify
}
