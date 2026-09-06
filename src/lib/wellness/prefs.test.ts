import { describe, expect, it } from 'vitest'
import { DEFAULT_WELLNESS } from '@/lib/contracts'
import { prefsPatch, recordGoalDay, resolveWellnessPrefs } from './prefs'

describe('resolveWellnessPrefs', () => {
  it('round-trips DEFAULT_WELLNESS through a JSON cycle unchanged', () => {
    const roundTripped = resolveWellnessPrefs(JSON.parse(JSON.stringify(DEFAULT_WELLNESS)))
    expect(roundTripped).toEqual(DEFAULT_WELLNESS)
  })

  it('fills in the full v2 shape for a pre-v2 stored row', () => {
    const resolved = resolveWellnessPrefs({ waterIntervalMin: 30 })
    expect(resolved.waterIntervalMin).toBe(30)
    expect(resolved.dock.placement).toBe('right')
    expect(resolved).toEqual({ ...DEFAULT_WELLNESS, waterIntervalMin: 30 })
  })

  it('deep merges dock so a shallow spread does not hand back a half-built object', () => {
    const resolved = resolveWellnessPrefs({ dock: { placement: 'left' } })
    expect(resolved.dock).toEqual({ placement: 'left', collapsed: false, compactOnExercise: true, corner: 'br' })
  })

  it('deep merges sound the same way', () => {
    const resolved = resolveWellnessPrefs({ sound: { enabled: false } })
    expect(resolved.sound).toEqual({ enabled: false, volume: 0.6, interface: false })
  })

  it('deep merges prayerReminders the same way', () => {
    const resolved = resolveWellnessPrefs({ prayerReminders: { fajr: false } })
    expect(resolved.prayerReminders).toEqual({ fajr: false, dhuhr: true, asr: true, maghrib: true, isha: true })
  })

  it('clamps dailyGoal into 1-10', () => {
    expect(resolveWellnessPrefs({ dailyGoal: 99 }).dailyGoal).toBe(10)
    expect(resolveWellnessPrefs({ dailyGoal: 0 }).dailyGoal).toBe(1)
    expect(resolveWellnessPrefs({ dailyGoal: -5 }).dailyGoal).toBe(1)
    expect(resolveWellnessPrefs({ dailyGoal: 5.7 }).dailyGoal).toBe(6)
  })

  it('clamps sound.volume into 0-1', () => {
    expect(resolveWellnessPrefs({ sound: { volume: 5 } }).sound.volume).toBe(1)
    expect(resolveWellnessPrefs({ sound: { volume: -2 } }).sound.volume).toBe(0)
  })

  it('drops unknown keys', () => {
    const resolved = resolveWellnessPrefs({ waterIntervalMin: 30, notARealKey: 'x' } as unknown)
    expect(resolved).not.toHaveProperty('notARealKey')
  })

  it('falls back to defaults entirely for garbage input', () => {
    expect(resolveWellnessPrefs(null)).toEqual(DEFAULT_WELLNESS)
    expect(resolveWellnessPrefs(undefined)).toEqual(DEFAULT_WELLNESS)
    expect(resolveWellnessPrefs('not an object')).toEqual(DEFAULT_WELLNESS)
    expect(resolveWellnessPrefs(42)).toEqual(DEFAULT_WELLNESS)
  })

  it('rejects an invalid theme, dock placement, corner, or motion value', () => {
    expect(resolveWellnessPrefs({ theme: 'neon' }).theme).toBe('midnight')
    expect(resolveWellnessPrefs({ dock: { placement: 'diagonal' } }).dock.placement).toBe('right')
    expect(resolveWellnessPrefs({ dock: { corner: 'center' } }).dock.corner).toBe('br')
    expect(resolveWellnessPrefs({ motion: 'turbo' }).motion).toBe('system')
  })

  it('keeps goalDays as an array of strings, dropping a malformed value', () => {
    expect(resolveWellnessPrefs({ goalDays: ['2026-09-01', '2026-09-02'] }).goalDays).toEqual(['2026-09-01', '2026-09-02'])
    expect(resolveWellnessPrefs({ goalDays: 'not-an-array' }).goalDays).toEqual([])
  })
})

describe('prefsPatch', () => {
  it('is empty for DEFAULT_WELLNESS itself', () => {
    expect(prefsPatch(DEFAULT_WELLNESS)).toEqual({})
  })

  it('carries only the keys that differ from the default', () => {
    const next = { ...DEFAULT_WELLNESS, dailyGoal: 7, theme: 'amber' as const }
    expect(prefsPatch(next)).toEqual({ dailyGoal: 7, theme: 'amber' })
  })

  it('treats a nested object as different when any of its fields differ', () => {
    const next = { ...DEFAULT_WELLNESS, dock: { ...DEFAULT_WELLNESS.dock, collapsed: true } }
    expect(prefsPatch(next)).toEqual({ dock: { ...DEFAULT_WELLNESS.dock, collapsed: true } })
  })
})

describe('recordGoalDay', () => {
  it('appends a new day', () => {
    expect(recordGoalDay([], '2026-09-06')).toEqual(['2026-09-06'])
    expect(recordGoalDay(['2026-09-05'], '2026-09-06')).toEqual(['2026-09-05', '2026-09-06'])
  })

  it('dedupes an already-recorded day without reordering', () => {
    expect(recordGoalDay(['2026-09-04', '2026-09-05'], '2026-09-05')).toEqual(['2026-09-04', '2026-09-05'])
  })

  it('moves a re-recorded day to the end if it was not already last', () => {
    expect(recordGoalDay(['2026-09-04', '2026-09-05'], '2026-09-04')).toEqual(['2026-09-05', '2026-09-04'])
  })

  it('caps at the most recent 120, newest last', () => {
    const days = Array.from({ length: 120 }, (_, i) => `2026-01-${String((i % 28) + 1).padStart(2, '0')}-${i}`)
    const result = recordGoalDay(days, 'new-day')
    expect(result).toHaveLength(120)
    expect(result[119]).toBe('new-day')
    expect(result[0]).toBe(days[1])
  })
})
