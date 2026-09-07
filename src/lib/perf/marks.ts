/**
 * The four named performance marks `e2e/perf.spec.ts` reads back with
 * `performance.getEntriesByName()` (spec R5.5.2, plan T3.2 step 1):
 * `brogram:shell-ready`, `brogram:route-ready`, `brogram:graded`, `brogram:check-verdict`.
 *
 * This module owns the mark names and a safe way to set/read them — nothing here calls
 * `markPerf()` on its own. `src/lib/perf/**` is this task's whole ownership; the four call
 * sites below each live in a different task's files and are not edited here. Until each
 * lands, the matching section of `e2e/perf.spec.ts` fails loudly (an absent mark), the same
 * way an unfixed budget row fails `perf:bundle` — a real, named gap, not a silent one:
 *
 *   - `SHELL_READY`   — once, after the app shell first mounts (`AppShell.tsx` or
 *                        `ShellLayout.tsx`, T0.7/T2.4).
 *   - `ROUTE_READY`   — once per navigation, when a route's own data is ready to paint
 *                        (`src/app/(app)/layout.tsx`, T2.1, or each page).
 *   - `GRADED`        — at every `setStatus('graded')` in `src/hooks/useExerciseLoop.ts`
 *                        (T2.2) — the instant the browser knows pass/fail, before the network
 *                        save.
 *   - `CHECK_VERDICT` — when a lesson check reveals right/wrong for a non-`micro-code` kind
 *                        (`src/components/lesson/CheckBlock.tsx`, T1.3).
 */

export const SHELL_READY = 'brogram:shell-ready'
export const ROUTE_READY = 'brogram:route-ready'
export const GRADED = 'brogram:graded'
export const CHECK_VERDICT = 'brogram:check-verdict'

export const PERF_MARKS = [SHELL_READY, ROUTE_READY, GRADED, CHECK_VERDICT] as const
export type PerfMarkName = (typeof PERF_MARKS)[number]

/** Sets one named mark. SSR-safe and feature-detected: instrumentation must never be the
 *  thing that throws and breaks the surface it is measuring. */
export function markPerf(name: PerfMarkName): void {
  if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return
  try {
    performance.mark(name)
  } catch {
    // A full performance entry buffer (or a disabled Performance API) must never surface here.
  }
}

/** The most recent entry for one mark in this page's lifetime, or `undefined` if it was
 *  never set — e.g. before the call site above has landed. */
export function latestMark(name: PerfMarkName): PerformanceMark | undefined {
  if (typeof performance === 'undefined' || typeof performance.getEntriesByName !== 'function') return undefined
  const entries = performance.getEntriesByName(name, 'mark') as PerformanceMark[]
  return entries.at(-1)
}

/** Test/e2e-only: clears every recorded entry for one mark, so a route measured a second
 *  time in the same page lifetime (three reps, per T3.2 step 2) starts from zero. */
export function clearPerfMark(name: PerfMarkName): void {
  if (typeof performance === 'undefined' || typeof performance.clearMarks !== 'function') return
  performance.clearMarks(name)
}
