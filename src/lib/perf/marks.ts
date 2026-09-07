/**
 * The four named performance marks `e2e/perf.spec.ts` reads back with
 * `performance.getEntriesByName()` (spec R5.5.2, plan T3.2 step 1):
 * `brogram:shell-ready`, `brogram:route-ready`, `brogram:graded`, `brogram:check-verdict`.
 *
 * This module owns the mark names and a safe way to set/read them — nothing here calls
 * `markPerf()` on its own; each call site lives in a different file (`src/lib/perf/**` is
 * this task's own ownership, those files are not). Fix round 2 (controller-granted one-line
 * call sites) landed three of the four:
 *
 *   - `SHELL_READY`   — landed: `src/components/shell/AppShell.tsx`, in a mount effect.
 *   - `ROUTE_READY`   — landed: `src/lib/perf/RouteReadyMark.tsx` (new, this task's own
 *                        file), mounted once from `src/app/(app)/layout.tsx`.
 *   - `CHECK_VERDICT` — landed: `src/components/lesson/CheckBlock.tsx`'s `grade()`, guarded
 *                        to non-`micro-code` kinds only.
 *   - `GRADED`        — still not called anywhere. Its call site, `src/hooks/
 *                        useExerciseLoop.ts` at every `setStatus('graded')`, belongs to the
 *                        exercise lane (mid-flight this session) and was not touched per the
 *                        controller's explicit ruling for this round. Until it lands,
 *                        `e2e/perf.spec.ts`'s submit -> verdict budget reports a named,
 *                        printed pending delta instead of failing the whole gate.
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
