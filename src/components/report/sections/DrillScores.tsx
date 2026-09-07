import type { DrillLane } from '@/lib/contracts'
import { DRILL_META } from '@/app/(app)/derot/lib'
import type { LaneDrillScores } from '../derive'

const LANE_LABELS: Record<DrillLane, string> = {
  arcade: 'Arcade',
  play: 'Playground',
}

interface DrillScoresProps {
  groups: LaneDrillScores[]
}

/**
 * De-rot scores, grouped by lane -- fix round 1, I6 (Wave 0 review I3): only
 * kinds this learner has actually run appear, so a game never played does
 * not occupy a permanent "Not attempted" row, and a lane with nothing run in
 * it at all (most commonly Playground, for a learner who has only used
 * Arcade) does not render an empty group heading either.
 *
 * TI-7, fix round 2: titles used to be a hand-copied `DRILL_LABELS` table
 * kept "in sync by hand" -- two entries (`color-nback`, `rhythm`) had no
 * positive assertion anywhere and had already drifted once. Reading
 * `DRILL_META[row.kind].title` directly makes a rename in the one real
 * source impossible to miss here; `Breathe.tsx` and `FollowTheDot.tsx`
 * already import `DRILL_META` the same way, so this is not a new pattern.
 */
export function DrillScores({ groups }: DrillScoresProps) {
  return (
    <section className="flex flex-col gap-3" data-section="drill-scores">
      <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">De-rot scores</h2>
      {groups.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">No de-rot runs yet. Scores appear here after the first one.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map(group => (
            <div key={group.lane} className="flex flex-col gap-2">
              <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{LANE_LABELS[group.lane]}</h3>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                {group.rows.map(row => (
                  <div key={row.kind} className="flex items-center justify-between border-b border-border pb-1.5">
                    <span className="text-[11px] font-medium text-foreground">{DRILL_META[row.kind].title}</span>
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      best {row.best} · mean {row.mean} · {row.count} run{row.count === 1 ? '' : 's'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
