import type { FocusLineData } from '../derive'

interface FocusLineProps {
  data: FocusLineData
}

/** Page-one header: display name, generated date, and the Planner's one-line focus. */
export function FocusLine({ data }: FocusLineProps) {
  return (
    <header className="flex flex-col gap-4 border-b border-border pb-6" data-section="focus-line">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <p className="text-micro tracking-[0.06em] text-muted-foreground uppercase">Progress report</p>
          <h1 className="mt-1 text-h2 text-foreground">{data.displayName}</h1>
        </div>
        <p className="shrink-0 text-small text-muted-foreground">Generated {data.generatedAtLabel}</p>
      </div>
      <p className="rounded-lg px-4 py-3 text-body text-foreground" style={{ backgroundColor: 'var(--report-accent-soft)' }}>
        {data.focus || 'No focus set yet. Keep attempting exercises to get a plan from the Planner.'}
      </p>
    </header>
  )
}
