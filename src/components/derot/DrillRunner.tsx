'use client'

import type { DrillItem, DrillResult } from '@/lib/contracts'
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
    default: {
      const exhaustive: never = item.kind
      throw new Error(`Unknown drill kind: ${String(exhaustive)}`)
    }
  }
}
