import type { Language, RunRequest, RunResult, RuntimeAdapter, TestCase, TestResult } from '@/lib/contracts'
import { buildJavaSource } from './java-normalize'

/** No server judge is wired up yet; the exercise screen hides Run/Submit for Java while this holds. */
export function judgeProviderAbsent(): boolean {
  const value = process.env.NEXT_PUBLIC_JUDGE_PROVIDER?.trim()
  return !value || value === 'none'
}

interface JudgeReply {
  stdout: string
  stderr: string
  compileOutput: string
  exitCode: number
  timedOut: boolean
  failureKind?: 'timeout' | 'runtime-error' | 'compile-error'
}

function failure(test: TestCase, kind: TestResult['failureKind'], stderr: string, durationMs = 0): TestResult {
  return { testId: test.id, passed: false, actual: '', expected: test.expected, stdout: '', stderr, durationMs, failureKind: kind }
}

function summarize(results: TestResult[], totalCount = results.length): RunResult {
  const passedCount = results.filter(result => result.passed).length
  return { ok: passedCount === results.length && totalCount === results.length, results, passedCount, totalCount, runtime: 'judge' }
}

/** Java executes remotely; cancelling a run aborts its HTTP request and settles every pending test. */
export class JudgeAdapter implements RuntimeAdapter {
  readonly language: Language = 'java'
  private current?: AbortController

  async warmup(): Promise<void> {
    // The server owns the provider connection; there is no browser package to load.
  }

  abort(): void { this.current?.abort() }

  async run(req: RunRequest): Promise<RunResult> {
    this.abort()
    const controller = new AbortController()
    this.current = controller
    const results: TestResult[] = []
    const code = req.language === 'java' ? buildJavaSource(req.code, req.fixture) : req.code
    const freeRun = req.tests.length === 0
    const tests = freeRun ? [{ id: 'run', input: '', expected: '', hidden: false }] : req.tests
    try {
      for (let index = 0; index < tests.length; index++) {
        const test = tests[index]
        const started = performance.now()
        try {
          const reply = await this.submit({ language: req.language, code, stdin: test.input }, controller, req.timeoutMs)
          const stderr = [reply.compileOutput, reply.stderr].filter(Boolean).join('\n')
          const executionFailure = reply.timedOut ? 'timeout' : reply.failureKind ?? (reply.exitCode !== 0 ? 'runtime-error' : undefined)
          if (freeRun) return { ...summarize([]), ok: !executionFailure, stdout: reply.stdout, stderr }
          const actual = reply.stdout.trim()
          const passed = !executionFailure && actual === test.expected.trim()
          results.push({ testId: test.id, passed, actual, expected: test.expected, stdout: reply.stdout, stderr, durationMs: performance.now() - started, ...(passed ? {} : { failureKind: executionFailure ?? 'wrong-answer' }) })
        } catch (error) {
          const timedOut = controller.signal.aborted
          const stderr = timedOut ? 'Java execution was cancelled or exceeded its time limit.' : error instanceof Error ? error.message : 'The Java judge is unavailable.'
          if (freeRun) return { ...summarize([]), ok: false, stdout: '', stderr }
          if (timedOut) {
            results.push(...tests.slice(index).map((remaining, offset) => failure(remaining, 'timeout', stderr, offset === 0 ? performance.now() - started : 0)))
          } else {
            // A transport/configuration failure is one actionable failure, not one
            // duplicate message (and chargeable retry) for every hidden test.
            results.push(failure(test, 'runtime-error', stderr, performance.now() - started))
          }
          break
        }
      }
      // A transport/configuration failure surfaces only one actionable result (see above),
      // but totalCount must still reflect every test the caller asked for.
      return summarize(results, req.tests.length)
    } finally {
      if (this.current === controller) this.current = undefined
    }
  }

  private async submit(body: { language: Language; code: string; stdin: string }, controller: AbortController, timeoutMs: number): Promise<JudgeReply> {
    // timeoutMs is a browser-runtime deadline; a remote Judge0 round trip needs longer,
    // so the client-side deadline for the judge is floored rather than honored as-is.
    const requested = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5_000
    const limit = Math.max(requested, 30_000)
    let onAbort: () => void = () => {}
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new DOMException('Aborted', 'AbortError'))
      if (controller.signal.aborted) onAbort()
      else controller.signal.addEventListener('abort', onAbort, { once: true })
    })
    const timer = setTimeout(() => controller.abort(), limit)
    try {
      return await Promise.race([aborted, (async () => {
        const response = await fetch('/api/judge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal })
        const value: unknown = await response.json().catch(() => null)
        const reply = value && typeof value === 'object' ? value as Record<string, unknown> : {}
        if (!response.ok) {
          if (reply.error === 'judge-absent') throw new Error('Java execution is not available yet.')
          if (reply.error === 'judge-not-configured') throw new Error('The Java judge is not configured. JUDGE0_API_KEY must be configured on the server.')
          throw new Error(typeof reply.message === 'string' ? reply.message : `The Java judge is unavailable (${response.status}${typeof reply.error === 'string' ? `: ${reply.error}` : ''}).`)
        }
        if (typeof reply.stdout !== 'string' || typeof reply.stderr !== 'string' || typeof reply.compileOutput !== 'string' || typeof reply.exitCode !== 'number' || typeof reply.timedOut !== 'boolean') {
          throw new Error('The Java judge returned an invalid execution result.')
        }
        return reply as unknown as JudgeReply
      })()])
    } finally {
      clearTimeout(timer)
      controller.signal.removeEventListener('abort', onAbort)
    }
  }
}
