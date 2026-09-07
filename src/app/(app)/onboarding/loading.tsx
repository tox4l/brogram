export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl space-y-8 py-16">
      <div className="space-y-3">
        <div className="h-3 w-28 animate-pulse rounded-full bg-muted" />
        <div className="h-px w-full animate-pulse bg-rule" />
      </div>
      <div className="space-y-8">
        <div className="h-8 w-4/5 animate-pulse rounded-lg bg-muted" />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="h-24 animate-pulse rounded-xl border border-border bg-card" />
          <div className="h-24 animate-pulse rounded-xl border border-border bg-card" />
        </div>
      </div>
    </div>
  )
}
