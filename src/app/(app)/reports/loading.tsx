/**
 * The shape of "Progress" (spec 10.10): a title, a two-tab bar, then the
 * Trophies grid -- the default tab -- so a fresh navigation never flashes a
 * bare spinner before the real tab bar and cards settle in.
 */
export default function ReportsLoading() {
  return (
    <div role="status" aria-label="Opening progress" className="space-y-6">
      <div className="h-7 w-32 animate-pulse rounded-full bg-muted" />
      <div className="flex h-8 w-56 items-center gap-2 rounded-lg bg-muted p-1">
        <div className="h-full w-1/2 animate-pulse rounded-lg bg-background" />
        <div className="h-full w-1/2 animate-pulse rounded-lg bg-muted-foreground/10" />
      </div>
      <div className="grid grid-cols-2 gap-3 pt-6 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl border border-rule bg-muted/40" />
        ))}
      </div>
    </div>
  )
}
