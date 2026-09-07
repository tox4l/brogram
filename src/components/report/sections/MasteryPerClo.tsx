import { Progress } from '@/components/ui/progress'
import type { MasteryRow } from '../derive'

interface MasteryPerCloProps {
  rows: MasteryRow[]
}

const GRID_COLS = 'grid-cols-[2.5rem_1fr_6rem_3.5rem_5rem]'

/** Compact table, one row per CLO, ordered by ordinal: score bar, chain, status. */
export function MasteryPerClo({ rows }: MasteryPerCloProps) {
  return (
    <section className="flex flex-1 flex-col gap-2" data-section="mastery-per-clo">
      <h2 className="text-micro tracking-[0.06em] text-muted-foreground uppercase">Mastery per learning outcome</h2>
      {rows.length === 0 ? (
        <p className="text-small text-muted-foreground">No course selected yet. Mastery appears here once a course starts.</p>
      ) : (
        <div className="flex flex-col divide-y divide-border">
          <div className={`grid ${GRID_COLS} gap-3 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase`}>
            <span>CLO</span>
            <span>Outcome</span>
            <span>Mastery</span>
            <span className="text-right">Chain</span>
            <span className="text-right">Status</span>
          </div>
          {rows.map(row => (
            <div key={row.cloId} className={`grid ${GRID_COLS} items-center gap-3 py-1`}>
              <span className="text-[11px] font-medium text-foreground">{row.ordinal}</span>
              <span className="truncate text-[11px] text-foreground" title={row.outcome}>
                {row.outcome}
              </span>
              <div className="flex items-center gap-2 [&_[data-slot=progress-indicator]]:!bg-[var(--report-accent)] [&_[data-slot=progress-track]]:!h-1.5 [&_[data-slot=progress-track]]:!bg-muted">
                <Progress value={row.score} className="flex-1" />
                <span className="w-6 shrink-0 text-right text-[10px] text-muted-foreground tabular-nums">{row.score}</span>
              </div>
              <span className="text-right text-[11px] text-foreground tabular-nums">{row.chain}/3</span>
              <span className="text-right text-[10px] font-medium">
                {row.closed ? (
                  <span style={{ color: 'var(--report-accent)' }}>Closed</span>
                ) : (
                  <span className="text-muted-foreground">In progress</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
