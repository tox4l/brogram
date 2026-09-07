import type { TimeSpentData } from '../derive'

interface TimeSpentProps {
  data: TimeSpentData
}

/** Total time and a per-day bar list, most recent MAX_TIME_SPENT_DAYS days, oldest first. */
export function TimeSpent({ data }: TimeSpentProps) {
  const maxMs = Math.max(1, ...data.days.map(day => day.ms))

  return (
    <section className="flex flex-col gap-3" data-section="time-spent">
      <div className="flex items-baseline justify-between">
        <h2 className="text-micro tracking-[0.06em] text-muted-foreground uppercase">Time spent</h2>
        <span className="text-micro text-muted-foreground">
          {data.totalLabel} total · {data.daysActive} active day{data.daysActive === 1 ? '' : 's'}
        </span>
      </div>
      {/* I5, fix round 1: the 1000-row report query cap (spec 5.6) means
          "total" above can silently under-report a prolific learner's real
          lifetime figure. This is the one place that ever needed to say so. */}
      {data.truncated && (
        <p className="text-[10px] leading-relaxed text-muted-foreground">Based on the most recent 1000 attempts, not the full history.</p>
      )}
      {data.days.length === 0 ? (
        <p className="text-small text-muted-foreground">No attempts logged yet. Time spent appears after the first exercise.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {data.days.map(day => (
            <div key={day.date} className="grid grid-cols-[3rem_1fr_3.5rem] items-center gap-2">
              <span className="text-[10px] text-muted-foreground">{day.label}</span>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${(day.ms / maxMs) * 100}%`, backgroundColor: 'var(--report-accent)' }}
                />
              </div>
              <span className="text-right text-[10px] text-muted-foreground tabular-nums">{day.durationLabel}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
