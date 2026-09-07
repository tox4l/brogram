/**
 * Pure helpers for the de-rot section and runner pages. Kept side-effect free
 * so the picking and streak rules have direct unit tests, the same shape as
 * src/components/derot/scoring.ts and src/lib/learner/bank.ts.
 */
import type { Difficulty, DrillItem, DrillKind, DrillLane, DrillResult, Language } from '@/lib/contracts'

export const DRILL_KINDS: DrillKind[] = ['predict-output', 'spot-the-bug', 'trace', 'hold-focus', 'n-back', 'speed-type']

/** Lane B: six non-coding games. Spec 7.9. Presentation lands with T2.9b. */
export const PLAY_KINDS: DrillKind[] = ['follow-the-dot', 'color-nback', 'reaction', 'rhythm', 'breathe', 'memory-grid']

// Arcade titles are the voice names (spec 7.9 / T2.9a step 2). The
// descriptions stay literal -- they explain the mechanic, not the brand --
// and are plain strings pending the T2.7a voice bank (T2.7b re-points them).
export const DRILL_META: Record<DrillKind, { title: string; description: string; lane: DrillLane }> = {
  'predict-output': { title: 'Call It', description: 'Read a snippet and type exactly what it prints before time runs out.', lane: 'arcade' },
  'spot-the-bug': { title: 'Find the Break', description: "Click the line that's broken before the clock runs out.", lane: 'arcade' },
  trace: { title: 'Run It in Your Head', description: "Step through execution and fill in each variable's value.", lane: 'arcade' },
  'hold-focus': { title: "Don't Blink", description: 'Read a technical passage without scrolling, then answer one question.', lane: 'arcade' },
  'n-back': { title: 'Two Back', description: 'Watch a stream of code tokens and catch the ones that repeat.', lane: 'arcade' },
  'speed-type': { title: 'Hands', description: 'Type a snippet exactly as shown. Accuracy counts more than speed.', lane: 'arcade' },
  'follow-the-dot': { title: 'Follow the Dot', description: 'Keep the pointer inside a dot that drifts and accelerates along a smooth path.', lane: 'play' },
  'color-nback': { title: 'Colour Back', description: 'Watch a stream of colours and shapes and catch the ones that match N back.', lane: 'play' },
  reaction: { title: 'Twitch', description: 'Ten rounds. Tap the instant the shape lights up; an early tap voids the round.', lane: 'play' },
  rhythm: { title: 'Keep Time', description: 'Tap on the beat for sixty seconds while the tempo drifts.', lane: 'play' },
  breathe: { title: 'Breathe', description: 'Follow a slow four-seven-eight breathing pace. This one cannot be failed.', lane: 'play' },
  'memory-grid': { title: 'Grid', description: 'Watch a pattern flash on the grid, then reproduce it before it fades.', lane: 'play' },
}

export function isArcadeKind(value: string | null | undefined): value is DrillKind {
  return DRILL_KINDS.includes(value as DrillKind)
}

export function isPlayKind(value: string | null | undefined): value is DrillKind {
  return PLAY_KINDS.includes(value as DrillKind)
}

/** True for any of the twelve DrillKind ids, either lane. Callers that need
 *  to gate on one specific lane should use isArcadeKind / isPlayKind instead. */
export function isDrillKind(value: string | null | undefined): value is DrillKind {
  return isArcadeKind(value) || isPlayKind(value)
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

/**
 * The most recent `limit` results for one kind, newest first -- the Arcade
 * run summary's personal-best scoreboard (spec 7.9 step 1). Since each
 * completed run is exactly one `DrillResult` row (never one per item), this
 * is simply the tail of the kind's own history: no separate "run" grouping
 * is needed.
 */
export function lastResultsForKind(results: DrillResult[], kind: DrillKind, limit = 5): DrillResult[] {
  return results
    .filter((result) => result.kind === kind)
    .slice()
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit)
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
  const kind = text(row.kind) as DrillKind
  const item: DrillItem = {
    id: text(row.id),
    kind,
    difficulty: asDifficulty(row.difficulty),
    payload: row.payload && typeof row.payload === 'object' ? (row.payload as Record<string, unknown>) : {},
    timeLimitS: typeof row.time_limit_s === 'number' ? row.time_limit_s : 60,
    lane: DRILL_META[kind]?.lane ?? 'arcade',
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
