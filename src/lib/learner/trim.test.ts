import { describe, it, expect } from 'vitest'
import type { MistakeRecord } from '@/lib/contracts'
import { MISTAKE_LIMIT, trimMistakes } from './trim'

function mistake(n: number, at: string): MistakeRecord {
  return { exerciseId: `ex-${n}`, cloId: 'INFS1101-3', pattern: 'loop-accumulate', label: `mistake ${n}`, at }
}

/** n mistakes, oldest first, one per day from 2026-03-01. */
function series(n: number): MistakeRecord[] {
  return Array.from({ length: n }, (_, i) => mistake(i, `2026-03-${String(i + 1).padStart(2, '0')}T10:00:00.000Z`))
}

describe('trimMistakes', () => {
  it('caps at ten', () => {
    expect(MISTAKE_LIMIT).toBe(10)
    expect(trimMistakes(series(14))).toHaveLength(10)
  })

  it('keeps the newest and drops the oldest first', () => {
    const kept = trimMistakes(series(14))
    expect(kept[0].exerciseId).toBe('ex-13')
    expect(kept[9].exerciseId).toBe('ex-4')
    expect(kept.map((m) => m.exerciseId)).not.toContain('ex-3')
  })

  it('orders newest first whatever order it is given', () => {
    const shuffled = [mistake(1, '2026-03-01T10:00:00.000Z'), mistake(3, '2026-03-03T10:00:00.000Z'), mistake(2, '2026-03-02T10:00:00.000Z')]
    expect(trimMistakes(shuffled).map((m) => m.exerciseId)).toEqual(['ex-3', 'ex-2', 'ex-1'])
  })

  it('drops duplicates of the same exercise at the same time', () => {
    const dupe = [mistake(1, '2026-03-01T10:00:00.000Z'), mistake(1, '2026-03-01T10:00:00.000Z')]
    expect(trimMistakes(dupe)).toHaveLength(1)
  })

  it('takes a smaller limit so a prompt over budget sheds the oldest first', () => {
    const kept = trimMistakes(series(10), 3)
    expect(kept.map((m) => m.exerciseId)).toEqual(['ex-9', 'ex-8', 'ex-7'])
  })

  it('never returns more than it was given and never mutates its input', () => {
    const given = series(4)
    const copy = [...given]
    expect(trimMistakes(given)).toHaveLength(4)
    expect(given).toEqual(copy)
  })

  it('handles an empty list', () => {
    expect(trimMistakes([])).toEqual([])
  })
})
