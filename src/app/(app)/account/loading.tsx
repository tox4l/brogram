/**
 * The shape of Account (spec 10.11): title, then the stacked settings
 * sections in their real order -- "Make it yours" is the tallest, so it
 * gets the biggest placeholder.
 */
export default function AccountLoading() {
  return (
    <div role="status" aria-label="Opening account" className="max-w-2xl space-y-6">
      <div className="space-y-2">
        <div className="h-7 w-28 animate-pulse rounded-full bg-muted" />
        <div className="h-3 w-48 animate-pulse rounded-full bg-muted" />
      </div>
      <div className="h-72 animate-pulse rounded-xl border border-border bg-muted/40" />
      <div className="h-40 animate-pulse rounded-xl border border-border bg-muted/40" />
      <div className="h-28 animate-pulse rounded-xl border border-border bg-muted/40" />
      <div className="h-24 animate-pulse rounded-xl border border-border bg-muted/40" />
    </div>
  )
}
