'use client'

/**
 * The controller's grant for `src/app/providers.tsx`: "a Vitals client component that calls
 * useVitalsCollector once and returns null, mounted beside MotionAttribute." Lives here, in
 * this task's own ownership (`src/lib/perf/**`), so `providers.tsx` only needs the one-line
 * mount below -- the same shape `vitals.ts`'s own header comment already described as owed.
 *
 * A dedicated, otherwise-empty client component is `useReportWebVitals`'s own documented
 * pattern (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-report-web-
 * vitals.md`): mounting it once, near the root, keeps the client boundary this hook needs as
 * small as possible.
 */

import { useVitalsCollector } from './vitals'

export function VitalsCollector(): null {
  useVitalsCollector()
  return null
}
