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
}

/**
 * Picks the presentation component for a drill item by its kind. `key={item.id}`
 * on each branch forces a remount (and a fresh one-shot onResult guard) whenever
 * the caller swaps in a new drill without unmounting DrillRunner itself.
 */
export function DrillRunner({ item, onResult, now = Date.now }: DrillRunnerProps) {
  switch (item.kind) {
    case 'predict-output':
      return <PredictOutput key={item.id} item={item} onResult={onResult} now={now} />
    case 'spot-the-bug':
      return <SpotTheBug key={item.id} item={item} onResult={onResult} now={now} />
    case 'trace':
      return <Trace key={item.id} item={item} onResult={onResult} now={now} />
    case 'hold-focus':
      return <HoldFocus key={item.id} item={item} onResult={onResult} now={now} />
    case 'n-back':
      return <NBack key={item.id} item={item} onResult={onResult} now={now} />
    case 'speed-type':
      return <SpeedType key={item.id} item={item} onResult={onResult} now={now} />
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
