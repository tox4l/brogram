export default function DerotHubLoading() {
  return (
    <div className="space-y-7" aria-hidden="true">
      <div className="space-y-2">
        <div className="h-7 w-32 animate-pulse rounded bg-muted" />
        <div className="h-4 w-72 animate-pulse rounded bg-muted" />
      </div>
      <div className="h-16 animate-pulse rounded-lg border border-border bg-muted/40" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-40 animate-pulse rounded-xl border border-border bg-muted/40" />
        ))}
      </div>
    </div>
  )
}
