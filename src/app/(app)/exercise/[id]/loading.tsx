/**
 * Step 10 / spec 5.4 (R5.3): the shape of the real workspace -- prompt panel,
 * editor chrome, results panel, all at real size -- not a spinner. Its mere
 * presence is also what turns router prefetching on for this dynamic route
 * (a route without `loading.tsx` is never prefetched by `<Link>`), which is
 * exactly why the dashboard's Next-up cards can now warm this screen ahead
 * of a click (spec 5.4's prefetch ladder).
 */
export default function ExerciseLoading() {
  return (
    <div role="status" aria-label="Opening your rep" className="space-y-4">
      <div className="space-y-3">
        <div className="h-3 w-16 animate-pulse rounded-full bg-muted" />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="h-7 w-2/3 max-w-md animate-pulse rounded-full bg-muted" />
          <div className="h-3 w-24 animate-pulse rounded-full bg-muted" />
        </div>
      </div>
      {/* Fix round C1: matches page.tsx's own container-query breakpoint (`@[75rem]`, not the
          viewport `xl:`) so the skeleton never promises a three-column layout the real page then
          declines to render once the dock rail is subtracted from the available width. The
          `@container` context and the `@[75rem]:` grid it gates are two different elements on
          purpose -- see page.tsx's matching comment: a size container query can never match the
          element that establishes its own containment context.
          Fix round 2, N1: mirrors page.tsx's `@[54rem]` two-column step (brief beside code,
          results spanning both tracks below) that fires at the 888px the default 'right' dock
          placement actually affords, so the skeleton and the real workspace agree at every
          width, including the one every default learner actually sees. */}
      <div className="@container">
      <div className="grid gap-6 @[54rem]:grid-cols-[22rem_minmax(0,1fr)] @[75rem]:grid-cols-[22rem_minmax(0,1.6fr)_20rem]">
        <div className="space-y-4">
          <div className="h-4 w-24 animate-pulse rounded-full bg-muted" />
          <div className="space-y-2">
            <div className="h-3 w-full animate-pulse rounded-full bg-muted" />
            <div className="h-3 w-full animate-pulse rounded-full bg-muted" />
            <div className="h-3 w-2/3 animate-pulse rounded-full bg-muted" />
          </div>
          <div className="h-24 animate-pulse rounded-lg bg-muted/40" />
        </div>
        <div className="overflow-hidden rounded-xl border border-rule bg-background">
          <div className="flex items-center gap-2 border-b border-rule px-4 py-3">
            <div className="h-3 w-20 animate-pulse rounded-full bg-muted" />
          </div>
          <div className="min-h-[360px] space-y-3 bg-lesson-code-surface p-4">
            {Array.from({ length: 8 }, (_, row) => (
              <div key={row} className="flex items-center gap-3">
                <div className="h-3 w-4 shrink-0 animate-pulse rounded-full bg-muted/70" />
                <div className="h-3 animate-pulse rounded-full bg-muted/70" style={{ width: `${40 + (row * 9) % 45}%` }} />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-rule p-3">
            <div className="h-9 w-20 animate-pulse rounded-lg bg-muted" />
            <div className="h-9 w-24 animate-pulse rounded-lg bg-muted" />
          </div>
        </div>
        <div className="space-y-4 @[54rem]:col-span-2 @[75rem]:col-span-1">
          <div className="h-4 w-16 animate-pulse rounded-full bg-muted" />
          <div className="h-16 animate-pulse rounded-lg bg-muted/40" />
          <div className="h-16 animate-pulse rounded-lg bg-muted/40" />
        </div>
      </div>
      </div>
    </div>
  )
}
