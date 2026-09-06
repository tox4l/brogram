/**
 * Pure helpers for the de-rot section and runner pages. Kept side-effect free
 * so the picking and streak rules have direct unit tests, the same shape as
 * src/components/derot/scoring.ts and src/lib/learner/bank.ts.
 */
import type { Difficulty, DrillItem, DrillKind, DrillResult, Language } from '@/lib/contracts'

export const DRILL_KINDS: DrillKind[] = ['predict-output', 'spot-the-bug', 'trace', 'hold-focus', 'n-back', 'speed-type']

export const DRILL_META: Record<DrillKind, { title: string; description: string }> = {
  'predict-output': { title: 'Predict the output', description: 'Read a snippet and type exactly what it prints before time runs out.' },
  'spot-the-bug': { title: 'Spot the bug', description: "Click the line that's broken before the clock runs out." },
  trace: { title: 'Trace by hand', description: "Step through execution and fill in each variable's value." },
  'hold-focus': { title: 'Hold focus', description: 'Read a technical passage without scrolling, then answer one question.' },
  'n-back': { title: 'N-back', description: 'Watch a stream of code tokens and catch the ones that repeat.' },
  'speed-type': { title: 'Speed type', description: 'Type a snippet exactly as shown. Accuracy counts more than speed.' },
}

export function isDrillKind(value: string | null | undefined): value is DrillKind {
  return DRILL_KINDS.includes(value as DrillKind)
}

// ---------------------------------------------------------------------------
// Dates: same convention as src/lib/learner/compile.ts -- the calendar day is
// read from the ISO string as written, never re-zoned through a local Date.
// ---------------------------------------------------------------------------

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/

export function dateKey(iso: string): string | null {
  const match = ISO_DATE.exec(iso)
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null
}

function dayBefore(key: string): string {
  const [year, month, day] = key.split('-').map(Number)
  const previous = new Date(Date.UTC(year, month - 1, day) - 24 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${previous.getUTCFullYear()}-${pad(previous.getUTCMonth() + 1)}-${pad(previous.getUTCDate())}`
}

/**
 * Consecutive UTC days with at least one drill result, ending on the most
 * recent day with activity, alive only while that run reaches today or
 * yesterday. Multiple results on the same day count once.
 */
export function computeDerotStreak(timestamps: string[], now: Date = new Date()): number {
  const todayKey = dateKey(now.toISOString())
  const keys = [...new Set(timestamps.map(dateKey).filter((key): key is string => key !== null))].sort().reverse()
  if (keys.length === 0) return 0
  if (todayKey === null || (keys[0] !== todayKey && keys[0] !== dayBefore(todayKey))) return 0

  let days = 1
  for (let i = 1; i < keys.length; i += 1) {
    if (keys[i] !== dayBefore(keys[i - 1])) break
    days += 1
  }
  return days
}

// ---------------------------------------------------------------------------
// Best / last score per kind
// ---------------------------------------------------------------------------

export interface KindStats {
  attempted: boolean
  best: number | null
  last: number | null
  lastAt: string | null
}

export function statsForKind(results: DrillResult[], kind: DrillKind): KindStats {
  const items = results.filter((result) => result.kind === kind)
  if (items.length === 0) return { attempted: false, best: null, last: null, lastAt: null }
  const best = Math.max(...items.map((result) => result.score))
  const mostRecent = items.reduce((a, b) => (a.at >= b.at ? a : b))
  return { attempted: true, best, last: mostRecent.score, lastAt: mostRecent.at }
}

// ---------------------------------------------------------------------------
// Row mapping: a snake_case `drills` row as the DrillItem contract shape.
// ---------------------------------------------------------------------------

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asDifficulty(value: unknown): Difficulty {
  const n = typeof value === 'number' ? Math.round(value) : Number.NaN
  if (!Number.isFinite(n)) return 3
  return Math.min(5, Math.max(1, n)) as Difficulty
}

export function mapDrillRow(row: Record<string, unknown>): DrillItem {
  const item: DrillItem = {
    id: text(row.id),
    kind: text(row.kind) as DrillKind,
    difficulty: asDifficulty(row.difficulty),
    payload: row.payload && typeof row.payload === 'object' ? (row.payload as Record<string, unknown>) : {},
    timeLimitS: typeof row.time_limit_s === 'number' ? row.time_limit_s : 60,
  }
  if (typeof row.language === 'string' && row.language) item.language = row.language as Language
  return item
}

// ---------------------------------------------------------------------------
// Picking: never-played first, then closest to a difficulty derived from the
// student's recent scores for this kind (higher recent scores push harder).
// ---------------------------------------------------------------------------

function recentTargetDifficulty(results: DrillResult[]): number {
  if (results.length === 0) return 3
  const recent = [...results].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5)
  const avgScore = recent.reduce((sum, result) => sum + result.score, 0) / recent.length
  return Math.min(5, Math.max(1, Math.round(1 + (avgScore / 100) * 4)))
}

function closestToDifficulty(items: DrillItem[], target: number): DrillItem {
  return items.reduce((best, item) => (Math.abs(item.difficulty - target) < Math.abs(best.difficulty - target) ? item : best))
}

/**
 * Picks one item of the given kind: an explicit deep-link id wins outright,
 * otherwise items not yet completed today are preferred over ones already
 * done today, never-played items are preferred over replays, and the pick
 * within that pool is the difficulty closest to the student's recent scores.
 */
export function pickDrillItem(
  items: DrillItem[],
  resultsForKind: DrillResult[],
  now: Date = new Date(),
  explicitId?: string | null,
): DrillItem | null {
  if (items.length === 0) return null
  if (explicitId) {
    const explicit = items.find((item) => item.id === explicitId)
    if (explicit) return explicit
  }

  const todayKey = dateKey(now.toISOString())
  const completedToday = new Set(resultsForKind.filter((result) => dateKey(result.at) === todayKey).map((result) => result.drillId))
  const everPlayed = new Set(resultsForKind.map((result) => result.drillId))

  const notDoneToday = items.filter((item) => !completedToday.has(item.id))
  const pool = notDoneToday.length > 0 ? notDoneToday : items

  const neverPlayed = pool.filter((item) => !everPlayed.has(item.id))
  const candidates = neverPlayed.length > 0 ? neverPlayed : pool

  return closestToDifficulty(candidates, recentTargetDifficulty(resultsForKind))
}
