/**
 * The shape of "Today" (spec 10.3), not a spinner: resume card, the
 * streak/goal/points row, the three next-up cards, then the level bar -- and
 * its mere presence turns on router prefetching for this route (a route
 * without `loading.tsx` is never prefetched by `<Link>`).
 */
export default function DashboardLoading() {
  return (
    <div role="status" aria-label="Opening your dashboard" className="space-y-8">
      <div className="space-y-2">
        <div className="h-7 w-2/3 animate-pulse rounded-full bg-muted" />
        <div className="h-3 w-1/3 animate-pulse rounded-full bg-muted" />
      </div>
      <div className="h-24 animate-pulse rounded-xl border border-rule bg-muted/40" />
      <div className="grid grid-cols-3 gap-3 border-b border-rule pb-6 sm:gap-6">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="space-y-2 py-1">
            <div className="h-3 w-16 animate-pulse rounded-full bg-muted" />
            <div className="h-6 w-14 animate-pulse rounded-full bg-muted" />
          </div>
        ))}
      </div>
      <div className="space-y-3">
        <div className="h-4 w-20 animate-pulse rounded-full bg-muted" />
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl border border-rule bg-muted/40" />
          ))}
        </div>
      </div>
      <div className="h-16 animate-pulse rounded-xl border border-rule bg-muted/40" />
    </div>
  )
}
