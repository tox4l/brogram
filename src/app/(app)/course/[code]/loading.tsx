/**
 * The shape of the real screen, not a spinner: header, a few grey path-map
 * rows, and the next-up grid -- and its mere presence turns on router
 * prefetching for this dynamic route (a route without `loading.tsx` is never
 * prefetched by `<Link>`).
 */
export default function CourseLoading() {
  return (
    <div role="status" aria-label="Opening your course" className="space-y-8">
      <div className="space-y-2">
        <div className="h-3 w-16 animate-pulse rounded-full bg-muted" />
        <div className="h-7 w-2/3 animate-pulse rounded-full bg-muted" />
        <div className="h-3 w-1/3 animate-pulse rounded-full bg-muted" />
      </div>
      <div className="space-y-4">
        <div className="h-4 w-24 animate-pulse rounded-full bg-muted" />
        <div className="space-y-3">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-center gap-4">
              <div className="size-9 shrink-0 animate-pulse rounded-full bg-muted" />
              <div className="h-3 w-1/2 animate-pulse rounded-full bg-muted" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl border border-rule bg-muted/40" />
        ))}
      </div>
    </div>
  )
}
