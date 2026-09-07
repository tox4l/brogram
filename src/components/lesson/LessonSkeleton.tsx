/** The shape of the page, not a spinner (spec 10.5, "loading skeleton"). Also
 *  used as the route's `loading.tsx`, which is what turns on router
 *  prefetching for a dynamic route with no other Suspense boundary.
 *
 *  T3.2 fix round 3 (N2-3): this placeholder's own content (a handful of
 *  fixed-height rows, ~450px) is always far shorter than a real lesson's
 *  blocks (INFS2101-3 measures ~3350px once mounted -- concept, snippet,
 *  worked and check blocks stack well past one screen). Swapping a short
 *  skeleton for that much taller real content pushed the root layout's
 *  `<footer>` (`src/app/layout.tsx`, outside this task's ownership) down
 *  from inside the viewport to far below it -- a real, 100%-reproducible
 *  layout shift on every cold load (measured live: `value: 0.105` on 5/5
 *  production-build runs, footer as the reported LayoutShift source),
 *  never a `page.reload()` measurement artefact. `min-h-dvh` here reserves
 *  one full viewport of space while loading, so the footer starts below
 *  the fold before any lesson content exists and never enters the visible
 *  viewport during the swap -- a shift that happens entirely off-screen
 *  contributes nothing to CLS's viewport-intersected impact fraction, for
 *  any lesson whose real content is at least one screen tall (every
 *  multi-block lesson in the curriculum). */
export function LessonSkeleton() {
  return (
    <div role="status" aria-label="Loading your walkthrough" className="mx-auto flex min-h-dvh max-w-3xl gap-6 py-12">
      <div aria-hidden="true" className="hidden w-4 shrink-0 flex-col gap-2 pt-2 sm:flex">
        {Array.from({ length: 5 }, (_, index) => <div key={index} className="size-1.5 rounded-full bg-muted" />)}
      </div>
      <div aria-hidden="true" className="min-w-0 max-w-[45rem] flex-1 space-y-6">
        <div className="h-3 w-24 animate-pulse rounded-full bg-muted" />
        <div className="h-7 w-2/3 animate-pulse rounded-lg bg-muted" />
        <div className="h-4 w-1/2 animate-pulse rounded-lg bg-muted" />
        <div className="space-y-2">
          <div className="h-4 w-full animate-pulse rounded-lg bg-muted" />
          <div className="h-4 w-5/6 animate-pulse rounded-lg bg-muted" />
          <div className="h-4 w-3/4 animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="h-40 w-full animate-pulse rounded-xl bg-muted" />
      </div>
      <span className="sr-only">Loading your walkthrough.</span>
    </div>
  )
}
