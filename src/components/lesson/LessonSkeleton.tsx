/** The shape of the page, not a spinner (spec 10.5, "loading skeleton"). Also
 *  used as the route's `loading.tsx`, which is what turns on router
 *  prefetching for a dynamic route with no other Suspense boundary. */
export function LessonSkeleton() {
  return (
    <div role="status" aria-label="Loading your walkthrough" className="mx-auto flex max-w-3xl gap-6 py-10">
      <div aria-hidden="true" className="hidden w-4 shrink-0 flex-col gap-2 pt-2 sm:flex">
        {Array.from({ length: 5 }, (_, index) => <div key={index} className="size-1.5 rounded-full bg-muted" />)}
      </div>
      <div aria-hidden="true" className="min-w-0 max-w-[45rem] flex-1 space-y-6">
        <div className="h-3 w-24 animate-pulse rounded-full bg-muted" />
        <div className="h-7 w-2/3 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-1/2 animate-pulse rounded-md bg-muted" />
        <div className="space-y-2">
          <div className="h-4 w-full animate-pulse rounded-md bg-muted" />
          <div className="h-4 w-5/6 animate-pulse rounded-md bg-muted" />
          <div className="h-4 w-3/4 animate-pulse rounded-md bg-muted" />
        </div>
        <div className="h-40 w-full animate-pulse rounded-xl bg-muted" />
      </div>
      <span className="sr-only">Loading your walkthrough.</span>
    </div>
  )
}
