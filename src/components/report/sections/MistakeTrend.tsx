import type { MistakeTrendData } from '../derive'

interface MistakeTrendProps {
  data: MistakeTrendData
}

/** A simple bar list, one row per week, oldest first, no charting library. */
export function MistakeTrend({ data }: MistakeTrendProps) {
  const maxCount = Math.max(1, ...data.weeks.map(week => week.count))

  return (
    <section className="flex flex-col gap-3" data-section="mistake-trend">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Mistake trend</h2>
        <span className="text-xs text-muted-foreground">{data.totalMistakes} in the last 12 weeks</span>
      </div>
      {data.totalMistakes === 0 ? (
        <p className="text-sm text-muted-foreground">No mistakes logged in the last 12 weeks. Clean run.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {data.weeks.map(week => (
            <div key={week.weekKey} className="grid grid-cols-[3rem_1fr_1.5rem] items-center gap-2">
              <span className="text-[10px] text-muted-foreground">{week.label}</span>
              <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${(week.count / maxCount) * 100}%`, backgroundColor: 'var(--report-accent)' }}
                />
              </div>
              <span className="text-right text-[10px] text-muted-foreground tabular-nums">{week.count}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
