'use client'

/**
 * Fires `brogram:route-ready` once per navigation -- the controller's grant for
 * `src/app/(app)/layout.tsx` ("ROUTE_READY once route data is ready to paint"), landed as a
 * new file under this task's own ownership (`src/lib/perf/**`) so the owning layout file only
 * needs the one-line mount below.
 *
 * `(app)/layout.tsx` is a Server Component kept alive across client-side transitions between
 * the routes it wraps -- Next's own docs (`node_modules/next/dist/docs/01-app/01-getting-
 * started/04-linking-and-navigating.md`, "Client-side transitions": shared layouts are kept,
 * only `children` is replaced). So a mark fired from that layout's own render, or from a plain
 * mount effect with no dependency, would fire exactly once, on the very first load, and never
 * again on the SPA transitions the course-tile-click and lesson-link budgets in
 * `e2e/perf.spec.ts` actually measure.
 *
 * `usePathname()` is different: it is driven by the router's own client-side state, which
 * updates in the very same commit that swaps in the new route's `children` -- regardless of
 * whether the Server Component wrapper around this marker re-executes. A `useLayoutEffect`
 * keyed on that value therefore fires synchronously right after each new route's content has
 * committed to the DOM (paint-adjacent, before the browser's next paint), which is exactly what
 * "route data is ready to paint" means for both the very first load and every later transition.
 */

import { useLayoutEffect } from 'react'
import { usePathname } from 'next/navigation'
import { markPerf, ROUTE_READY } from './marks'

export function RouteReadyMark() {
  const pathname = usePathname()
  useLayoutEffect(() => {
    markPerf(ROUTE_READY)
  }, [pathname])
  return null
}
