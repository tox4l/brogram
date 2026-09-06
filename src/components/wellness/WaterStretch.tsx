'use client'

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { CupSoda, PersonStanding } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { WellnessPrefs } from '@/lib/contracts'
import { dateKeyOf } from '@/lib/wellness/prayer'
import { advanceRecurringTimer, computeLogStreak, dueRecurringTimer, startRecurringTimer, type RecurringTimerState } from '@/lib/wellness/timers'

export interface WellnessLogEntry {
  kind: 'water' | 'stretch'
  at: string
}

/**
 * Tracks a recurring reminder's next-due timestamp in a ref rather than state: nothing in
 * the UI needs to re-render off it (only a toast fires), so advancing it is a plain side
 * effect instead of a setState call inside an effect.
 */
function useRecurringTimer(now: number, intervalMin: number, message: string) {
  const timerRef = useRef<RecurringTimerState>(startRecurringTimer(now, intervalMin))
  const intervalRef = useRef(intervalMin)

  useEffect(() => {
    if (intervalRef.current === intervalMin) return
    intervalRef.current = intervalMin
    timerRef.current = startRecurringTimer(now, intervalMin)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMin])

  useEffect(() => {
    if (!dueRecurringTimer(timerRef.current, now)) return
    toast(message)
    timerRef.current = advanceRecurringTimer(timerRef.current, now, intervalMin)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now])
}

export function WaterStretch({ prefs, now, log, onLog, compact = false }: {
  prefs: WellnessPrefs
  now: number
  log: WellnessLogEntry[]
  onLog: (entry: WellnessLogEntry) => void
  compact?: boolean
}) {
  useRecurringTimer(now, prefs.waterIntervalMin, 'Take a sip of water.')
  useRecurringTimer(now, prefs.stretchIntervalMin, 'Stand up and stretch for a moment.')

  const today = dateKeyOf(new Date(now))
  const streak = computeLogStreak(log.map((entry) => entry.at.slice(0, 10)), today)

  const logWater = () => onLog({ kind: 'water', at: new Date(now).toISOString() })
  const logStretch = () => onLog({ kind: 'stretch', at: new Date(now).toISOString() })

  if (compact) {
    return (
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <button type="button" onClick={logWater} className="flex items-center gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"><CupSoda className="size-3.5" aria-hidden="true" />Water</button>
        <button type="button" onClick={logStretch} className="flex items-center gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"><PersonStanding className="size-3.5" aria-hidden="true" />Stretch</button>
      </div>
    )
  }

  return (
    <div>
      <h3 className="text-sm font-medium">Water &amp; stretch</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Every {prefs.waterIntervalMin} minutes for water, {prefs.stretchIntervalMin} for a stretch.</p>
      <div className="mt-3 flex gap-2">
        <Button variant="outline" size="sm" onClick={logWater} className="flex-1"><CupSoda />Log water</Button>
        <Button variant="outline" size="sm" onClick={logStretch} className="flex-1"><PersonStanding />Log stretch</Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{streak > 0 ? `${streak} ${streak === 1 ? 'day' : 'days'} of staying on top of it.` : 'Log one to start a streak.'}</p>
    </div>
  )
}
