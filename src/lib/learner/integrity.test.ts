import { describe, it, expect } from 'vitest'
import type { IntegrityEventType } from '@/lib/contracts'
import { INTEGRITY_THRESHOLDS } from '@/lib/contracts'
import { integrityScore, maxPasteInExercise, statusFor } from './integrity'

const NOW = new Date('2026-03-10T12:00:00.000Z')

function ago(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
}

function events(type: IntegrityEventType, count: number, over: { days?: number; exerciseId?: string | null } = {}) {
  return Array.from({ length: count }, () => ({
    type,
    exerciseId: 'exerciseId' in over ? over.exerciseId ?? null : 'ex-1',
    createdAt: ago(over.days ?? 1),
  }))
}

describe('integrityScore', () => {
  it('scores five blurs and one blocked paste as 7', () => {
    expect(integrityScore([...events('blur', 5), ...events('paste-blocked', 1)], NOW)).toBe(7)
  })

  it('gives idle and blocked context menus no weight', () => {
    expect(integrityScore([...events('idle', 20), ...events('contextmenu-blocked', 20)], NOW)).toBe(0)
  })

  it('weighs copy-blocked at 2 and printscreen at 3', () => {
    expect(integrityScore([...events('copy-blocked', 2), ...events('printscreen', 2)], NOW)).toBe(10)
  })

  it('ignores events older than the seven day window', () => {
    const stale = events('paste-blocked', 20, { days: 8 })
    const fresh = events('blur', 3, { days: 6 })
    expect(integrityScore([...stale, ...fresh], NOW)).toBe(3)
  })

  it('scores nothing for an empty log', () => {
    expect(integrityScore([], NOW)).toBe(0)
  })
})

describe('statusFor', () => {
  it('leaves an account active below the warn threshold', () => {
    expect(statusFor(7, 0)).toBe('active')
    expect(statusFor(9, 0)).toBe('active')
  })

  it('warns at 10', () => {
    expect(statusFor(10, 0)).toBe('warned')
    expect(statusFor(19, 0)).toBe('warned')
  })

  it('restricts at 20', () => {
    expect(statusFor(20, 0)).toBe('restricted')
    expect(statusFor(39, 0)).toBe('restricted')
  })

  it('bans at 40', () => {
    expect(statusFor(40, 0)).toBe('banned')
    expect(statusFor(120, 0)).toBe('banned')
  })

  it('restricts on five pastes in one exercise regardless of score', () => {
    expect(statusFor(0, 5)).toBe('restricted')
    expect(statusFor(0, 4)).toBe('active')
    expect(statusFor(INTEGRITY_THRESHOLDS.banAt, 5)).toBe('banned')
  })

  it('reads the thresholds from the contracts', () => {
    expect(statusFor(INTEGRITY_THRESHOLDS.warnAt, 0)).toBe('warned')
    expect(statusFor(INTEGRITY_THRESHOLDS.restrictAt, 0)).toBe('restricted')
    expect(statusFor(INTEGRITY_THRESHOLDS.instantRestrictPasteCount - 1, 0)).toBe('active')
  })
})

describe('the escalation table end to end', () => {
  it('walks active, warned, restricted, banned as blocked pastes pile up', () => {
    const paste = (n: number) => events('paste-blocked', n)
    expect(statusFor(integrityScore([...events('blur', 5), ...paste(1)], NOW), 0)).toBe('active')
    expect(statusFor(integrityScore(events('blur', 10), NOW), 0)).toBe('warned')
    expect(statusFor(integrityScore(paste(10), NOW), 0)).toBe('restricted')
    expect(statusFor(integrityScore(paste(20), NOW), 0)).toBe('banned')
  })
})

describe('maxPasteInExercise', () => {
  it('counts blocked pastes per exercise inside the window', () => {
    const log = [...events('paste-blocked', 5, { exerciseId: 'ex-1' }), ...events('paste-blocked', 2, { exerciseId: 'ex-2' })]
    expect(maxPasteInExercise(log, NOW)).toBe(5)
  })

  it('never merges two exercises into one count, so six spread pastes do not restrict', () => {
    const log = [...events('paste-blocked', 3, { exerciseId: 'ex-1' }), ...events('paste-blocked', 3, { exerciseId: 'ex-2' })]
    expect(maxPasteInExercise(log, NOW)).toBe(3)
    expect(statusFor(integrityScore(log, NOW), maxPasteInExercise(log, NOW))).toBe('warned')

    const same = events('paste-blocked', 5, { exerciseId: 'ex-1' })
    expect(statusFor(integrityScore(same, NOW), maxPasteInExercise(same, NOW))).toBe('restricted')
  })

  it('ignores stale pastes, other event types and pastes with no exercise', () => {
    const log = [
      ...events('paste-blocked', 9, { exerciseId: 'ex-1', days: 8 }),
      ...events('copy-blocked', 9, { exerciseId: 'ex-1' }),
      ...events('paste-blocked', 9, { exerciseId: null }),
      ...events('paste-blocked', 2, { exerciseId: 'ex-1' }),
    ]
    expect(maxPasteInExercise(log, NOW)).toBe(2)
  })

  it('counts nothing for an empty log', () => {
    expect(maxPasteInExercise([], NOW)).toBe(0)
  })
})
