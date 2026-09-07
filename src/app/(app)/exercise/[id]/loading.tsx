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
    <div role="status" aria-label="Opening your exercise" className="space-y-5">
      <div className="space-y-3">
        <div className="h-3 w-16 animate-pulse rounded-full bg-muted" />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="h-7 w-2/3 max-w-md animate-pulse rounded-full bg-muted" />
          <div className="h-3 w-24 animate-pulse rounded-full bg-muted" />
        </div>
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(12rem,0.8fr)_minmax(22rem,1.7fr)_minmax(14rem,0.9fr)]">
        <div className="space-y-4">
          <div className="h-4 w-24 animate-pulse rounded-full bg-muted" />
          <div className="space-y-2">
            <div className="h-3 w-full animate-pulse rounded-full bg-muted" />
            <div className="h-3 w-full animate-pulse rounded-full bg-muted" />
            <div className="h-3 w-2/3 animate-pulse rounded-full bg-muted" />
          </div>
          <div className="h-24 animate-pulse rounded-lg bg-muted/40" />
        </div>
        <div className="overflow-hidden rounded-xl border border-border bg-background">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <div className="h-3 w-20 animate-pulse rounded-full bg-muted" />
          </div>
          <div className="min-h-[360px] space-y-3 p-4">
            {Array.from({ length: 8 }, (_, row) => (
              <div key={row} className="flex items-center gap-3">
                <div className="h-3 w-4 shrink-0 animate-pulse rounded bg-muted/70" />
                <div className="h-3 animate-pulse rounded bg-muted/70" style={{ width: `${40 + (row * 9) % 45}%` }} />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-border p-3">
            <div className="h-9 w-20 animate-pulse rounded-md bg-muted" />
            <div className="h-9 w-24 animate-pulse rounded-md bg-muted" />
          </div>
        </div>
        <div className="space-y-4">
          <div className="h-4 w-16 animate-pulse rounded-full bg-muted" />
          <div className="h-16 animate-pulse rounded-lg bg-muted/40" />
          <div className="h-16 animate-pulse rounded-lg bg-muted/40" />
        </div>
      </div>
    </div>
  )
}
