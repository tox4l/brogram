'use client'

import type { DrillItem, DrillResult } from '@/lib/contracts'
import { Card, CardContent } from '@/components/ui/card'
import { PredictOutput } from './PredictOutput'
import { SpotTheBug } from './SpotTheBug'
import { Trace } from './Trace'
import { HoldFocus } from './HoldFocus'
import { NBack } from './NBack'
import { SpeedType } from './SpeedType'

export interface DrillRunnerProps {
  item: DrillItem
  onResult: (result: DrillResult) => void
  now?: () => number
  /** Threaded to the six timed components' own countdowns (fix round 1, I3): true while the tab is hidden, so no item's clock can run out unseen. */
  paused?: boolean
}

/**
 * Picks the presentation component for a drill item by its kind. `key={item.id}`
 * on each branch forces a remount (and a fresh one-shot onResult guard) whenever
 * the caller swaps in a new drill without unmounting DrillRunner itself.
 *
 * The Arcade run page (src/app/(app)/derot/arcade/[kind]/page.tsx) relies on
 * exactly this: it swaps `item` after each answer without ever unmounting
 * DrillRunner, so a six-item run remounts only the per-kind child each time,
 * never this switch. DrillRunner itself carries no run, combo or score-lane
 * logic -- that lives in the run model (arcade/run.ts) and scoring.ts, kept
 * frozen here so the item-in / result-out contract never changes underneath it.
 */
export function DrillRunner({ item, onResult, now = Date.now, paused = false }: DrillRunnerProps) {
  switch (item.kind) {
    case 'predict-output':
      return <PredictOutput key={item.id} item={item} onResult={onResult} now={now} paused={paused} />
    case 'spot-the-bug':
      return <SpotTheBug key={item.id} item={item} onResult={onResult} now={now} paused={paused} />
    case 'trace':
      return <Trace key={item.id} item={item} onResult={onResult} now={now} paused={paused} />
    case 'hold-focus':
      return <HoldFocus key={item.id} item={item} onResult={onResult} now={now} paused={paused} />
    case 'n-back':
      return <NBack key={item.id} item={item} onResult={onResult} now={now} paused={paused} />
    case 'speed-type':
      return <SpeedType key={item.id} item={item} onResult={onResult} now={now} paused={paused} />
    case 'follow-the-dot':
    case 'color-nback':
    case 'reaction':
    case 'rhythm':
    case 'breathe':
    case 'memory-grid':
      return <DrillPlaceholder key={item.id} />
    default: {
      const exhaustive: never = item.kind
      throw new Error(`Unknown drill kind: ${String(exhaustive)}`)
    }
  }
}

/** Playground kinds land in a later update; this keeps the runner honest instead of crashing. */
function DrillPlaceholder() {
  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardContent className="py-8 text-center text-sm text-muted-foreground">
        This one is coming in the next update.
      </CardContent>
    </Card>
  )
}
