'use client'

import { Button } from '@/components/ui/button'
import { LOCKDOWN } from '@/lib/contracts'

export function HintButton({ available, waitSeconds, count, busy, onRequest }: {
  available: boolean; waitSeconds: number; count: number; busy: boolean; onRequest: () => void
}) {
  const exhausted = count >= LOCKDOWN.maxHintsPerExercise
  return <div className="space-y-2">
    <Button variant="outline" disabled={!available || busy || exhausted} onClick={onRequest} className="w-full transition-none active:translate-y-0">{exhausted ? 'All hints used' : 'Ask for a hint'}</Button>
    <p className="text-xs leading-relaxed text-muted-foreground">{exhausted ? 'Use your fix plan to guide the next attempt.' : `${count} of ${LOCKDOWN.maxHintsPerExercise} hints used.${!available && waitSeconds > 0 ? ` Available in ${waitSeconds}s${count === 0 ? ', or after an edit' : ''}.` : ''}`}</p>
  </div>
}
