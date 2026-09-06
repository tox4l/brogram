import type { DrillKind } from '@/lib/contracts'
import type { DrillKindSummary } from '../derive'

/** Titles mirror DRILL_META in src/app/(app)/derot/lib.ts, kept in sync by hand since that file is frozen. */
const DRILL_LABELS: Record<DrillKind, string> = {
  'predict-output': 'Predict the output',
  'spot-the-bug': 'Spot the bug',
  trace: 'Trace by hand',
  'hold-focus': 'Hold focus',
  'n-back': 'N-back',
  'speed-type': 'Speed type',
  'follow-the-dot': 'Follow the Dot',
  'color-nback': 'Colour Back',
  reaction: 'Twitch',
  rhythm: 'Keep Time',
  breathe: 'Breathe',
  'memory-grid': 'Grid',
}

interface DrillScoresProps {
  rows: DrillKindSummary[]
}

/** De-rot scores grouped by drill kind: best, mean, and run count. All twelve kinds always show, even at zero. */
export function DrillScores({ rows }: DrillScoresProps) {
  return (
    <section className="flex flex-col gap-3" data-section="drill-scores">
      <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">De-rot scores</h2>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2">
        {rows.map(row => (
          <div key={row.kind} className="flex items-center justify-between border-b border-border pb-1.5">
            <span className="text-[11px] font-medium text-foreground">{DRILL_LABELS[row.kind]}</span>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {row.count === 0 ? 'Not attempted' : `best ${row.best} · mean ${row.mean} · ${row.count} run${row.count === 1 ? '' : 's'}`}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
