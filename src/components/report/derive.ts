/**
 * Pure derivation functions for the progress report.
 *
 * Everything the report renders is computed here from the props ReportPages
 * receives. No fetching, no side effects, nothing async: props in, numbers
 * out. This is what derive.test.ts exercises directly.
 */

import type { Attempt, Clo, CloId, DrillKind, DrillLane, DrillResult, LearnerState, PatternId } from '@/lib/contracts'

// ---------------------------------------------------------------------------
// Caps. Every list on the report is bounded so a section never overflows its
// A4 page regardless of how much history a student has.
// ---------------------------------------------------------------------------

export const MAX_MASTERY_ROWS = 26
export const MAX_PATTERN_GROUPS = 10
export const MAX_PATTERNS_PER_GROUP = 6
export const MISTAKE_TREND_WEEKS = 12
export const MAX_TIME_SPENT_DAYS = 14

/** Fixed order the twelve de-rot drills (Arcade then Playground) are always shown in, seed or not. */
const DRILL_KIND_ORDER: DrillKind[] = [
  'predict-output', 'spot-the-bug', 'trace', 'hold-focus', 'n-back', 'speed-type',
  'follow-the-dot', 'color-nback', 'reaction', 'rhythm', 'breathe', 'memory-grid',
]

// ---------------------------------------------------------------------------
// Small formatting helpers
// ---------------------------------------------------------------------------

/** "2h 15m" / "45m" / "0m". Never negative, never blank. */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

/** "September 5, 2026" in UTC so the report is deterministic regardless of the renderer's timezone. */
export function formatReportDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(date)
}

/** "Sep 1" in UTC, used as the label for a week bucket's Monday. */
function formatWeekLabel(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date)
}

/** Midnight UTC of the Monday that starts the ISO week containing `date`. */
function mondayOfWeekUtc(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dayIndex = (d.getUTCDay() + 6) % 7 // 0 = Monday .. 6 = Sunday
  d.setUTCDate(d.getUTCDate() - dayIndex)
  return d
}

function weekKey(date: Date): string {
  return mondayOfWeekUtc(date).toISOString().slice(0, 10)
}

/** Minute-truncated ISO instant ('YYYY-MM-DDTHH:MM'), used to match a mistake record to the attempt it was diagnosed from. */
function minuteKey(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toISOString().slice(0, 16)
}

// ---------------------------------------------------------------------------
// Mastery per CLO
// ---------------------------------------------------------------------------

export interface MasteryRow {
  cloId: CloId
  ordinal: number
  outcome: string
  score: number
  chain: number
  closed: boolean
  patternsPassed: PatternId[]
}

/** For every CLO of state.currentCourse, ordered by ordinal, capped so the table always fits page one. */
export function deriveMasteryRows(state: LearnerState, clos: Clo[], limit = MAX_MASTERY_ROWS): MasteryRow[] {
  return clos
    .filter(clo => clo.course === state.currentCourse)
    .slice()
    .sort((a, b) => a.ordinal - b.ordinal)
    .slice(0, limit)
    .map(clo => {
      const mastery = state.mastery[clo.id]
      return {
        cloId: clo.id,
        ordinal: clo.ordinal,
        outcome: clo.outcome,
        score: mastery?.score ?? 0,
        chain: mastery?.chain ?? 0,
        closed: mastery?.closed ?? false,
        patternsPassed: mastery?.patternsPassed ?? [],
      }
    })
}

// ---------------------------------------------------------------------------
// Patterns passed
// ---------------------------------------------------------------------------

export interface PatternGroup {
  cloId: CloId
  ordinal: number
  patterns: PatternId[]
  /** Patterns beyond MAX_PATTERNS_PER_GROUP, folded into a "+N more" line. */
  moreCount: number
}

export interface PatternsPassedData {
  groups: PatternGroup[]
  /** CLOs with at least one pattern passed, beyond MAX_PATTERN_GROUPS, folded into a "+N more" line. */
  moreGroupsCount: number
  /** Distinct patterns passed across the whole current course, uncapped. */
  totalDistinctPatterns: number
}

/** The union of patternsPassed across mastery rows for the current course, grouped by CLO. */
export function derivePatternsPassed(
  state: LearnerState,
  clos: Clo[],
  maxGroups = MAX_PATTERN_GROUPS,
  maxPerGroup = MAX_PATTERNS_PER_GROUP
): PatternsPassedData {
  const rows = deriveMasteryRows(state, clos, Number.POSITIVE_INFINITY).filter(row => row.patternsPassed.length > 0)

  const totalDistinctPatterns = new Set(rows.flatMap(row => row.patternsPassed)).size

  const groups: PatternGroup[] = rows.slice(0, maxGroups).map(row => ({
    cloId: row.cloId,
    ordinal: row.ordinal,
    patterns: row.patternsPassed.slice(0, maxPerGroup),
    moreCount: Math.max(0, row.patternsPassed.length - maxPerGroup),
  }))

  return {
    groups,
    moreGroupsCount: Math.max(0, rows.length - maxGroups),
    totalDistinctPatterns,
  }
}

// ---------------------------------------------------------------------------
// Mistake trend over time
// ---------------------------------------------------------------------------

export interface MistakeWeek {
  weekKey: string
  label: string
  count: number
}

export interface MistakeTrendData {
  /** Exactly MISTAKE_TREND_WEEKS entries, oldest first, most recent (the week of generatedAt) last. */
  weeks: MistakeWeek[]
  /** Sum of counts across the shown weeks. */
  totalMistakes: number
}

/**
 * Failed attempts plus any recentMistakes entries, bucketed by the UTC ISO
 * week (Monday start) they occurred in, over a trailing MISTAKE_TREND_WEEKS
 * window anchored on generatedAt so the trend is deterministic.
 *
 * compileLearnerState derives recentMistakes from failed attempts, so a
 * diagnosed failure the caller still has in `attempts` would otherwise be
 * counted twice: once as the failed attempt, once as its mistake record.
 * Failed attempts are the base set, keyed by exerciseId plus the
 * minute-truncated timestamp; a recentMistakes entry is added only when no
 * attempt shares that key (e.g. it fell outside the attempts the caller
 * passed in, or predates them).
 */
export function deriveMistakeTrend(state: LearnerState, attempts: Attempt[], generatedAt: string): MistakeTrendData {
  const anchor = new Date(generatedAt)
  const anchorMonday = Number.isNaN(anchor.getTime()) ? mondayOfWeekUtc(new Date()) : mondayOfWeekUtc(anchor)

  const weeks: MistakeWeek[] = []
  for (let i = MISTAKE_TREND_WEEKS - 1; i >= 0; i--) {
    const monday = new Date(anchorMonday)
    monday.setUTCDate(monday.getUTCDate() - i * 7)
    weeks.push({ weekKey: weekKey(monday), label: formatWeekLabel(monday), count: 0 })
  }
  const bucketByKey = new Map(weeks.map(w => [w.weekKey, w]))

  const failedAttempts = attempts.filter(a => a.passed === false)
  const diagnosedKeys = new Set(failedAttempts.map(a => `${a.exerciseId}|${minuteKey(a.createdAt)}`))

  const dates: string[] = [
    ...failedAttempts.map(a => a.createdAt),
    ...state.recentMistakes
      .filter(m => !diagnosedKeys.has(`${m.exerciseId}|${minuteKey(m.at)}`))
      .map(m => m.at),
  ]

  for (const iso of dates) {
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) continue
    const bucket = bucketByKey.get(weekKey(date))
    if (bucket) bucket.count += 1
  }

  return { weeks, totalMistakes: weeks.reduce((sum, w) => sum + w.count, 0) }
}

// ---------------------------------------------------------------------------
// Time spent
// ---------------------------------------------------------------------------

export interface DayTime {
  date: string // 'YYYY-MM-DD' (UTC)
  label: string
  ms: number
  durationLabel: string
}

export interface TimeSpentData {
  totalMs: number
  totalLabel: string
  daysActive: number
  /** Most recent MAX_TIME_SPENT_DAYS active days, oldest first. */
  days: DayTime[]
  /**
   * I5, fix round 1 (Opus review of `b509b0e`): true when `attempts` is the
   * capped, narrow report query at its cap (`REPORT_ATTEMPTS_CAP` in
   * `src/app/(app)/reports/data.ts`) rather than the learner's complete
   * history. `totalMs`/`totalLabel` read as lifetime figures ("{n} total");
   * once the fetch itself is capped, that claim is no longer necessarily
   * true, so the section needs to say so rather than silently under-report.
   */
  truncated: boolean
}

/** Sum of attempts[].durationMs per UTC calendar day, plus the grand total.
 *  `truncated` (the caller already knows whether the attempts it passed in
 *  hit the report query's row cap) rides straight into `TimeSpentData` --
 *  this function has no way to tell a genuinely-complete short history from
 *  a capped one on its own. */
export function deriveTimeSpent(attempts: Attempt[], limit = MAX_TIME_SPENT_DAYS, truncated = false): TimeSpentData {
  const byDay = new Map<string, number>()
  let totalMs = 0

  for (const attempt of attempts) {
    const date = new Date(attempt.createdAt)
    if (Number.isNaN(date.getTime())) continue
    const key = date.toISOString().slice(0, 10)
    byDay.set(key, (byDay.get(key) ?? 0) + attempt.durationMs)
    totalMs += attempt.durationMs
  }

  const sortedDays = Array.from(byDay.entries()).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const shown = sortedDays.slice(-limit)

  const days: DayTime[] = shown.map(([date, ms]) => ({
    date,
    label: formatWeekLabel(new Date(`${date}T00:00:00.000Z`)),
    ms,
    durationLabel: formatDuration(ms),
  }))

  return { totalMs, totalLabel: formatDuration(totalMs), daysActive: byDay.size, days, truncated }
}

// ---------------------------------------------------------------------------
// De-rot scores
// ---------------------------------------------------------------------------

export interface DrillKindSummary {
  kind: DrillKind
  best: number
  mean: number
  count: number
}

export interface LaneDrillScores {
  lane: DrillLane
  /** Only kinds this learner has actually run, in DRILL_KIND_ORDER. */
  rows: DrillKindSummary[]
}

/** Display order: Arcade before Playground, matching every other de-rot
 *  surface (the hub, the run screen). */
const LANE_ORDER: DrillLane[] = ['arcade', 'play']

/**
 * `drillResults` grouped by lane, then by kind, best/mean/count -- fix round
 * 1, I6 (Wave 0 review I3, routed here): the previous version always
 * rendered all twelve kinds, most of them "Not attempted" forever for a
 * learner who has not touched a given kind or an entire lane yet. This now
 * shows only kinds with at least one real result, and a lane with zero
 * attempted kinds is omitted entirely rather than shown as an empty group --
 * "render only lanes and kinds with data" (fix round 1 dispatch), literally.
 * The lane itself is read from each `DrillResult.lane`, never a static
 * kind-to-lane table: a kind's actual results already say which lane they
 * were run in, so nothing here needs to duplicate `DRILL_META`'s mapping
 * (`src/app/(app)/derot/lib.ts`, outside this file's ownership).
 */
export function deriveDrillScores(drillResults: DrillResult[]): LaneDrillScores[] {
  const byLaneThenKind = new Map<DrillLane, Map<DrillKind, number[]>>()
  for (const result of drillResults) {
    const byKind = byLaneThenKind.get(result.lane) ?? new Map<DrillKind, number[]>()
    const scores = byKind.get(result.kind) ?? []
    scores.push(result.score)
    byKind.set(result.kind, scores)
    byLaneThenKind.set(result.lane, byKind)
  }

  const groups: LaneDrillScores[] = []
  for (const lane of LANE_ORDER) {
    const byKind = byLaneThenKind.get(lane)
    if (!byKind || byKind.size === 0) continue
    const rows: DrillKindSummary[] = DRILL_KIND_ORDER
      .filter(kind => byKind.has(kind))
      .map(kind => {
        const scores = byKind.get(kind)!
        const best = Math.max(...scores)
        const mean = Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length)
        return { kind, best, mean, count: scores.length }
      })
    groups.push({ lane, rows })
  }
  return groups
}

// ---------------------------------------------------------------------------
// Focus line
// ---------------------------------------------------------------------------

export interface FocusLineData {
  focus: string
  displayName: string
  generatedAtLabel: string
}

/** The Planner's focus line, with the display name and a human-readable generated date. */
export function deriveFocusLine(focus: string, displayName: string, generatedAt: string): FocusLineData {
  return { focus, displayName, generatedAtLabel: formatReportDate(generatedAt) }
}
