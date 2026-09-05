import { Badge } from '@/components/ui/badge'
import type { PatternsPassedData } from '../derive'

interface PatternsPassedProps {
  data: PatternsPassedData
}

/** The union of patterns passed per CLO, grouped and capped so the section always fits its page. */
export function PatternsPassed({ data }: PatternsPassedProps) {
  return (
    <section className="flex flex-col gap-3" data-section="patterns-passed">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Patterns passed</h2>
        <span className="text-xs text-muted-foreground">
          {data.totalDistinctPatterns} distinct pattern{data.totalDistinctPatterns === 1 ? '' : 's'}
        </span>
      </div>
      {data.groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No patterns passed yet. They appear here once a chain closes.</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {data.groups.map(group => (
            <div key={group.cloId} className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 shrink-0 text-[11px] font-medium text-foreground">{group.cloId}</span>
              {group.patterns.map(pattern => (
                <Badge key={pattern} variant="outline">
                  {pattern}
                </Badge>
              ))}
              {group.moreCount > 0 && <span className="text-[11px] text-muted-foreground">+{group.moreCount} more</span>}
            </div>
          ))}
          {data.moreGroupsCount > 0 && (
            <p className="text-[11px] text-muted-foreground">+{data.moreGroupsCount} more learning outcomes with patterns</p>
          )}
        </div>
      )}
    </section>
  )
}
