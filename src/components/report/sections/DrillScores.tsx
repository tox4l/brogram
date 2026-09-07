import type { DrillKind } from '@/lib/contracts'
import type { DrillKindSummary } from '../derive'

/**
 * Titles mirror DRILL_META in src/app/(app)/derot/lib.ts, kept in sync by
 * hand since this file lives outside T2.9a's usual owned paths (fix round 1,
 * item 10: retitled to the voice names so the report agrees with the hub and
 * the run screen instead of showing the pre-rename Arcade titles).
 */
const DRILL_LABELS: Record<DrillKind, string> = {
  'predict-output': 'Call It',
  'spot-the-bug': 'Find the Break',
  trace: 'Run It in Your Head',
  'hold-focus': "Don't Blink",
  'n-back': 'Two Back',
  'speed-type': 'Hands',
  'follow-the-dot': 'Follow the Dot',
  'color-nback': 'Match Back',
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
