export default function PlayRunnerLoading() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className="h-4 w-24 animate-pulse rounded-lg bg-muted" />
      <div className="h-8 w-48 animate-pulse rounded-lg bg-muted" />
      <div className="mx-auto h-72 w-full max-w-2xl animate-pulse rounded-xl border border-rule bg-muted/40" />
    </div>
  )
}
