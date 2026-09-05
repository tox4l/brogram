import type { AccountStatus, IntegrityEvent } from '@/lib/contracts'
import { INTEGRITY_THRESHOLDS, INTEGRITY_WEIGHTS } from '@/lib/contracts'

/** The slice of an integrity event the ban math needs. */
export type ScorableEvent = Pick<IntegrityEvent, 'type' | 'createdAt'> & Partial<Pick<IntegrityEvent, 'exerciseId'>>

const WINDOW_MS = INTEGRITY_THRESHOLDS.windowDays * 24 * 60 * 60 * 1000

function inWindow(event: ScorableEvent, now: Date): boolean {
  const at = Date.parse(event.createdAt)
  return Number.isFinite(at) && now.getTime() - at <= WINDOW_MS
}

/** Sum of INTEGRITY_WEIGHTS over the events inside the seven day window. */
export function integrityScore(events: ScorableEvent[], now: Date = new Date()): number {
  return events.reduce((total, event) => (inWindow(event, now) ? total + (INTEGRITY_WEIGHTS[event.type] ?? 0) : total), 0)
}

/** The worst blocked-paste count any single exercise collected inside the window. */
export function maxPasteInExercise(events: ScorableEvent[], now: Date = new Date()): number {
  const perExercise = new Map<string, number>()

  for (const event of events) {
    if (event.type !== 'paste-blocked' || !event.exerciseId || !inWindow(event, now)) continue
    perExercise.set(event.exerciseId, (perExercise.get(event.exerciseId) ?? 0) + 1)
  }

  return perExercise.size === 0 ? 0 : Math.max(...perExercise.values())
}

/** The escalation table from spec section 9. */
export function statusFor(score: number, pasteInExercise: number = 0): AccountStatus {
  if (score >= INTEGRITY_THRESHOLDS.banAt) return 'banned'
  if (score >= INTEGRITY_THRESHOLDS.restrictAt || pasteInExercise >= INTEGRITY_THRESHOLDS.instantRestrictPasteCount) return 'restricted'
  if (score >= INTEGRITY_THRESHOLDS.warnAt) return 'warned'
  return 'active'
}
