/**
 * Resolving and patching WellnessPrefs (contracts C4).
 *
 * Rows stored before v2 never carried dock/theme/sound/motion/dailyGoal/
 * goalDays. A shallow `{ ...DEFAULT_WELLNESS, ...raw }` spread hands back a
 * half-built `dock` (whatever the caller sent, missing the other three keys)
 * for every such row, which is a runtime crash the first time a consumer
 * reads `dock.collapsed`, not a graceful fallback. `resolveWellnessPrefs`
 * merges one level deeper for every object-valued key so a partial nested
 * object is completed from the default rather than replacing it outright.
 * Unknown top-level keys are dropped; known values are validated against
 * their allowed range/set and clamped/rejected back to the default on
 * anything out of bounds, so a corrupted or hand-edited row can never
 * produce a WellnessPrefs the rest of the app has to defensively re-check.
 */

import { DEFAULT_WELLNESS, type DockCorner, type DockPlacement, type MotionPreference, type ThemeName, type WellnessPrefs } from '@/lib/contracts'
import { THEMES } from '@/lib/theme/themes'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number.NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

function clampFloat(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number.NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

// T4.0 fix round 3 (F4/M3): derived from the same registry `ThemeQuickSwitch`
// and the Account picker render from, so a sixth palette added to `THEMES`
// cannot leave a stored `wellness.prefs.theme` silently unrecognised the
// way a hand-enumerated list did for `eclipse` in fix round 1.
// Exported (only) so contrast.test.ts (T4.0's own gate file) can assert
// this list stays derived rather than drifting back to a hand-enumerated
// one -- nothing outside a test imports it.
export const THEME_NAMES: ThemeName[] = THEMES.map((theme) => theme.id)
const DOCK_PLACEMENTS: DockPlacement[] = ['left', 'right', 'top', 'float', 'hidden']
const DOCK_CORNERS: DockCorner[] = ['tl', 'tr', 'bl', 'br']
const MOTION_PREFERENCES: MotionPreference[] = ['system', 'full', 'reduced']

const PRAYER_NAMES = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const

function resolvePrayerReminders(raw: unknown): WellnessPrefs['prayerReminders'] {
  const source = isPlainObject(raw) ? raw : {}
  const defaults = DEFAULT_WELLNESS.prayerReminders
  const result = { ...defaults }
  for (const name of PRAYER_NAMES) result[name] = pickBoolean(source[name], defaults[name])
  return result
}

function resolveDock(raw: unknown): WellnessPrefs['dock'] {
  const source = isPlainObject(raw) ? raw : {}
  const defaults = DEFAULT_WELLNESS.dock
  return {
    placement: pickEnum(source.placement, DOCK_PLACEMENTS, defaults.placement),
    collapsed: pickBoolean(source.collapsed, defaults.collapsed),
    compactOnExercise: pickBoolean(source.compactOnExercise, defaults.compactOnExercise),
    corner: pickEnum(source.corner, DOCK_CORNERS, defaults.corner),
  }
}

function resolveSound(raw: unknown): WellnessPrefs['sound'] {
  const source = isPlainObject(raw) ? raw : {}
  const defaults = DEFAULT_WELLNESS.sound
  return {
    enabled: pickBoolean(source.enabled, defaults.enabled),
    volume: clampFloat(source.volume, 0, 1, defaults.volume),
    interface: pickBoolean(source.interface, defaults.interface),
  }
}

const MAX_GOAL_DAYS = 120

function resolveGoalDays(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_WELLNESS.goalDays]
  const strings = raw.filter((v): v is string => typeof v === 'string')
  return [...new Set(strings)].slice(-MAX_GOAL_DAYS)
}

/** Deep merge over DEFAULT_WELLNESS. A shallow spread hands back a half-built
 *  `dock` for every row stored before v2, which is a runtime crash, not a
 *  fallback. Unknown keys are dropped; out-of-range values are clamped. */
export function resolveWellnessPrefs(raw: unknown): WellnessPrefs {
  const source = isPlainObject(raw) ? raw : {}
  return {
    prayerReminders: resolvePrayerReminders(source.prayerReminders),
    prayerLeadMinutes: clamp(source.prayerLeadMinutes, 0, 60, DEFAULT_WELLNESS.prayerLeadMinutes),
    waterIntervalMin: clamp(source.waterIntervalMin, 1, 240, DEFAULT_WELLNESS.waterIntervalMin),
    stretchIntervalMin: clamp(source.stretchIntervalMin, 1, 240, DEFAULT_WELLNESS.stretchIntervalMin),
    pomodoroWorkMin: clamp(source.pomodoroWorkMin, 1, 120, DEFAULT_WELLNESS.pomodoroWorkMin),
    pomodoroBreakMin: clamp(source.pomodoroBreakMin, 1, 60, DEFAULT_WELLNESS.pomodoroBreakMin),
    useDeviceLocation: pickBoolean(source.useDeviceLocation, DEFAULT_WELLNESS.useDeviceLocation),
    dock: resolveDock(source.dock),
    theme: pickEnum(source.theme, THEME_NAMES, DEFAULT_WELLNESS.theme),
    sound: resolveSound(source.sound),
    motion: pickEnum(source.motion, MOTION_PREFERENCES, DEFAULT_WELLNESS.motion),
    dailyGoal: clamp(source.dailyGoal, 1, 10, DEFAULT_WELLNESS.dailyGoal),
    goalDays: resolveGoalDays(source.goalDays),
  }
}

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => isEqual(v, b[i]))
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    return [...keys].every((key) => isEqual(a[key], b[key]))
  }
  return false
}

/** The inverse: only the keys that differ from DEFAULT_WELLNESS, for the write. */
export function prefsPatch(next: WellnessPrefs): Partial<WellnessPrefs> {
  const patch: Partial<WellnessPrefs> = {}
  for (const key of Object.keys(next) as (keyof WellnessPrefs)[]) {
    if (!isEqual(next[key], DEFAULT_WELLNESS[key])) (patch as Record<string, unknown>)[key] = next[key]
  }
  return patch
}

/** Append today's UTC date key, dedupe, keep the most recent 120. */
export function recordGoalDay(days: string[], dateKey: string): string[] {
  const withoutDay = days.filter((day) => day !== dateKey)
  const next = [...withoutDay, dateKey]
  return next.slice(-MAX_GOAL_DAYS)
}
