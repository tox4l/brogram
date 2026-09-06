'use client'

import { useEffect, useState } from 'react'
import type { RunRequest, TestCase } from '@/lib/contracts'
import { JavaAdapter } from '@/lib/runtimes/java'
import { subscribeRuntimeProgress } from '@/lib/runtimes/progress'
import smoke from '../../../../seed/exercises/smoke.json'
import unverified from '../../../../seed/exercises/unverified/INFS3102.json'

/**
 * Development-only harness (the preview layout 404s outside development): runs
 * every Java exercise's reference solution through the real CheerpJ adapter and
 * publishes the outcome on window.__javaVerify for e2e/java/*.spec.ts. This is
 * the only way to certify the Java bank - scripts/verify-exercise.mjs runs in
 * Node, where there is no CheerpJ and therefore no javac.
 */

interface Failure { testId: string; expected: string; actual: string; stderr: string; failureKind?: string }
interface Row { file: string; title: string; cloId: string; pattern: string; passed: number; total: number; ms: number; failures: Failure[] }
interface Verify { rows: Row[]; compileError: { failureKind?: string; stderr: string } | null; done: boolean; error: string | null; status: string }

interface SeedExercise {
  cloId: string
  language: string
  kind: string
  pattern: string
  title: string
  starterCode: string
  fixture?: string
  tests: { id: string; input: string; expected: string; hidden: boolean; name?: string }[]
  referenceSolution: string
}

const BANK: { file: string; exercise: SeedExercise }[] = [
  ...(smoke.exercises as SeedExercise[]).filter(item => item.language === 'java').map(exercise => ({ file: 'smoke.json', exercise })),
  ...(unverified.exercises as SeedExercise[]).filter(item => item.language === 'java' && item.kind === 'code').map(exercise => ({ file: 'unverified/INFS3102.json', exercise })),
]

const BROKEN_SOLUTION = 'class Solution {\n    public static String describe(String kind, double a) {\n        return missing(kind)\n    }\n}\n'

function toRequest(exercise: SeedExercise, code: string): RunRequest {
  return { language: 'java', code, fixture: exercise.fixture, tests: exercise.tests as TestCase[], timeoutMs: 5000 }
}

// Each CheerpJ worker holds an 18 MB JVM and the adapter keeps a warm standby,
// so the run must start exactly once per page load: React mounts this component
// twice in development, and four JVMs on one page thrash badly.
let state: Verify | null = null

/**
 * Started once per page load and never cancelled: unmounting a component must
 * not abort a run that takes minutes, and in development the harness is
 * mounted twice. window.__javaVerify is the authoritative result; the table
 * below just polls it.
 */
function startVerification(): Verify {
  if (state) return state
  const verify: Verify = { rows: [], compileError: null, done: false, error: null, status: 'starting' }
  state = verify
  // e2e/java/support.ts owns the Window declaration for this key.
  ;(window as unknown as { __javaVerify: Verify }).__javaVerify = verify
  subscribeRuntimeProgress(event => { verify.status = `${event.phase}: ${event.packageName}` })
  const adapter = new JavaAdapter()

  // ?only=smoke keeps the default e2e suite to one exercise plus the
  // compile-error case; the full bank run is the tagged spec's job.
  const only = new URLSearchParams(window.location.search).get('only')
  const bank = only ? BANK.filter(entry => entry.file.includes(only)) : BANK

  void (async () => {
    try {
      for (const { file, exercise } of bank) {
        verify.status = `running ${exercise.title}`
        console.log(`[java-verify] start ${exercise.title}`)
        const startedAt = performance.now()
        const result = await adapter.run(toRequest(exercise, exercise.referenceSolution))
        const row: Row = {
          file, title: exercise.title, cloId: exercise.cloId, pattern: exercise.pattern,
          passed: result.passedCount, total: exercise.tests.length, ms: Math.round(performance.now() - startedAt),
          failures: result.results.filter(item => !item.passed).map(item => ({
            testId: item.testId, expected: item.expected, actual: item.actual,
            stderr: item.stderr.slice(0, 600), failureKind: item.failureKind,
          })),
        }
        verify.rows.push(row)
        console.log(`[java-verify] ${row.title}: ${row.passed}/${row.total} in ${row.ms} ms${row.failures[0] ? ` | ${row.failures[0].testId} expected ${JSON.stringify(row.failures[0].expected)} got ${JSON.stringify(row.failures[0].actual)}` : ''}`)
      }

      verify.status = 'checking the compile-error path'
      const broken = await adapter.run(toRequest(BANK[0].exercise, BROKEN_SOLUTION))
      verify.compileError = { failureKind: broken.results[0]?.failureKind, stderr: broken.results[0]?.stderr ?? '' }
    } catch (error) {
      verify.error = error instanceof Error ? error.message : String(error)
    } finally {
      verify.done = true
      verify.status = verify.error ? `failed: ${verify.error}` : 'done'
      console.log(`[java-verify] done: ${verify.rows.filter(row => row.passed === row.total).length}/${verify.rows.length} green`)
    }
  })()
  return verify
}

export default function JavaVerifyPage() {
  // Started from an effect, never during render: the run mutates its state
  // immediately and a render-phase start makes hydration disagree with itself.
  const [snapshot, setSnapshot] = useState<Verify | null>(null)

  useEffect(() => {
    const verify = startVerification()
    setSnapshot({ ...verify })
    const timer = window.setInterval(() => setSnapshot({ ...verify }), 500)
    return () => window.clearInterval(timer)
  }, [])

  const rows = snapshot?.rows ?? []
  const status = snapshot?.status ?? 'starting'
  const passedExercises = rows.filter(row => row.passed === row.total).length
  return (
    <main className="mx-auto max-w-5xl space-y-4 p-8">
      <h1 className="text-xl font-medium">Java bank verification <span className="text-muted-foreground">(development only)</span></h1>
      <p role="status" className="text-sm text-muted-foreground">{status} · {passedExercises}/{rows.length} exercises green</p>
      <table className="w-full border-collapse text-left text-xs">
        <thead><tr className="border-b border-border"><th className="py-2">Exercise</th><th>Outcome</th><th>Pattern</th><th>Tests</th><th>ms</th><th>First failure</th></tr></thead>
        <tbody>
          {/* Keyed by outcome and title: two exercises are both called "Coffee order pricing". */}
          {rows.map(row => (
            <tr key={`${row.cloId}|${row.title}`} className="border-b border-border/50 align-top">
              <td className="py-1.5 pr-3">{row.title}</td>
              <td className="pr-3">{row.cloId}</td>
              <td className="pr-3">{row.pattern}</td>
              <td className={`pr-3 ${row.passed === row.total ? 'text-emerald-500' : 'text-red-500'}`}>{row.passed}/{row.total}</td>
              <td className="pr-3">{row.ms}</td>
              <td className="max-w-md break-words font-mono">{row.failures[0] ? `${row.failures[0].testId}: expected ${JSON.stringify(row.failures[0].expected)} got ${JSON.stringify(row.failures[0].actual)} ${row.failures[0].stderr}` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}
