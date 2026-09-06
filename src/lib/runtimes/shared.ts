import type { RunResult, Runtime, TestCase, TestResult } from '@/lib/contracts'

export interface ExecutionOutput {
  actual: string
  stdout: string
  stderr: string
  failureKind?: TestResult['failureKind']
  /**
   * The runtime instance is no longer trustworthy (its JVM died mid-test, say).
   * The adapter replaces it with the warm standby before the next run. Never
   * part of a TestResult: makeTestResult drops it.
   */
  fatal?: boolean
}

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => equal(v, b[i]))
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>
  return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(k => Object.hasOwn(right, k) && equal(left[k], right[k]))
}
export function compareOutput(actual: string, expected: string): boolean {
  if (actual === expected) return true
  try { return equal(JSON.parse(actual), JSON.parse(expected)) } catch { return false }
}
export function makeTestResult(test: TestCase, output: ExecutionOutput, durationMs: number): TestResult {
  // `fatal` steers the adapter, not the grade, and TestResults are stored.
  const { fatal: _fatal, ...graded } = output
  const passed = !output.failureKind && compareOutput(output.actual, test.expected)
  return { testId: test.id, expected: test.expected, ...graded, durationMs, passed, ...(passed ? {} : { failureKind: output.failureKind ?? 'wrong-answer' }) }
}
export function summarizeResults(results: TestResult[], runtime: Runtime = 'browser'): RunResult {
  const passedCount = results.filter(r => r.passed).length
  return { ok: passedCount === results.length, passedCount, totalCount: results.length, results, runtime }
}
export function errorOutput(error: unknown): ExecutionOutput {
  return { actual: '', stdout: '', stderr: error instanceof Error ? error.message : String(error), failureKind: 'runtime-error' }
}
export function browserTimeout(ms: number): number {
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, 5000) : 5000
}
