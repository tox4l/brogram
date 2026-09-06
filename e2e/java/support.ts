import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'

export interface JavaVerifyFailure { testId: string; expected: string; actual: string; stderr: string; failureKind?: string }
export interface JavaVerifyRow { file: string; title: string; cloId: string; pattern: string; passed: number; total: number; ms: number; failures: JavaVerifyFailure[] }
export interface JavaVerify { rows: JavaVerifyRow[]; compileError: { failureKind?: string; stderr: string } | null; done: boolean; error: string | null; status: string }

export interface BankExercise {
  cloId: string
  language: string
  kind: string
  pattern: string
  title: string
  fixture?: string
  tests: { id: string; input: string; expected: string; hidden: boolean; name?: string }[]
  referenceSolution: string
}
export interface BankEntry { file: string; exercise: BankExercise }

declare global {
  interface Window {
    __javaVerify?: JavaVerify
    __javaBank?: BankEntry[]
  }
}

const ROOT = join(__dirname, '..', '..')

/** Reads a seed bank file here, in Node - reference solutions never reach the app bundle. */
export function readJavaBank(file: string, kinds = ['code']): BankEntry[] {
  const { exercises } = JSON.parse(readFileSync(join(ROOT, 'seed', 'exercises', file), 'utf8')) as { exercises: BankExercise[] }
  return exercises
    .filter(exercise => exercise.language === 'java' && kinds.includes(exercise.kind))
    .map(exercise => ({ file, exercise }))
}

/** Opens the development-only Java harness with an injected bank and waits for it to finish. */
export async function javaVerifyResult(page: Page, bank: BankEntry[], timeout = 20 * 60 * 1000): Promise<JavaVerify> {
  page.on('console', message => {
    const text = message.text()
    if (message.type() === 'error') console.log(`[browser error] ${text}`)
    else if (text.startsWith('[java-verify]')) console.log(text)
  })
  page.on('pageerror', error => console.log(`[pageerror] ${error.message}`))
  // addInitScript runs before the page's own scripts, so the harness sees the
  // bank on its first render.
  await page.addInitScript(entries => { window.__javaBank = entries }, bank)
  await page.goto('/preview/java-verify')
  await page.waitForFunction(() => window.__javaVerify?.done === true, { timeout })
  return (await page.evaluate(() => window.__javaVerify)) as JavaVerify
}
