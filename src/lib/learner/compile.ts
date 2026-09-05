import type {
  AccountStatus,
  CloId,
  Difficulty,
  DrillResult,
  IntegrityEventType,
  LearnerProfile,
  LearnerState,
  Mastery,
  MistakeRecord,
  PatternId,
} from '@/lib/contracts'
import { pointsForPass } from '@/lib/contracts'
import { integrityScore } from './integrity'
import { trimMistakes } from './trim'

// ---------------------------------------------------------------------------
// Server row shapes (snake_case, straight from Supabase)
// ---------------------------------------------------------------------------

export interface ProfileRow {
  id: string
  display_name?: string | null
  account_status?: AccountStatus | null
  restricted_until?: string | null
  invite_code?: string | null
  created_at?: string | null
  last_seen_at?: string | null
}

export interface MasteryRow {
  user_id?: string | null
  clo_id: string
  score?: number | null
  chain?: number | null
  patterns_passed?: PatternId[] | null
  closed?: boolean | null
  last_attempt_at?: string | null
}

export interface AttemptRow {
  id?: string
  user_id?: string | null
  exercise_id: string
  code?: string | null
  results?: unknown
  passed: boolean
  duration_ms?: number | null
  hint_count?: number | null
  created_at: string
  /** Joined from the exercise when the caller selected it; the defaults below cover a bare attempts row. */
  difficulty?: number | null
  clo_id?: string | null
  pattern?: PatternId | null
  /** From the Reviewer reply for this attempt. */
  quality?: number | null
  /** From the Diagnoser reply for this attempt; without it the failure is not a recorded mistake. */
  mistake_label?: string | null
}

export interface IntegrityEventRow {
  id?: string
  user_id?: string | null
  type: IntegrityEventType
  exercise_id?: string | null
  during_attempt?: boolean | null
  created_at: string
}

export interface WellnessRow {
  user_id?: string | null
  prefs?: unknown
  pomodoro_sessions?: unknown
  water_log?: unknown
  drill_results?: DrillResult[] | null
  updated_at?: string | null
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** What a learner looks like before the Profiler has said anything. */
export const DEFAULT_LEARNER_PROFILE: LearnerProfile = {
  displayName: '',
  learningStyle: 'mixed',
  styleVector: { visual: 0.5, verbal: 0.5, example: 0.5, theory: 0.5 },
  tone: 'supportive',
  verbosity: 'short',
  motivation: { why: '', beyondCourses: false, depth: 'understand', wantsAgenticCoding: false },
  onboardingComplete: false,
}

/** Attempts carry no difficulty of their own; the loop starts everyone at 3. */
const FALLBACK_DIFFICULTY: Difficulty = 3
/** Points are scored before the Reviewer answers, so an unscored pass is worth a middling quality. */
const FALLBACK_QUALITY = 70

// ---------------------------------------------------------------------------
// Dates: the calendar day as written in the timestamp, never re-zoned
// ---------------------------------------------------------------------------

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/

/**
 * The convention, one rule for every date in this file: the day is read from
 * the ISO string exactly as written, with no `Date` round-trip that could shift
 * it by the machine's offset. Postgres hands back `timestamptz` in UTC, so
 * `now` is turned into a key the same way, through `now.toISOString()`.
 */
function dateKey(iso: string): string | null {
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
 * Consecutive days ending on the most recent one with activity, and only while
 * that run is still alive: a run that ended before yesterday is a dead streak
 * and counts 0, though the last active date is still reported.
 */
function streakOf(timestamps: string[], todayKey: string | null): { days: number; last: string | null } {
  const keys = [...new Set(timestamps.map(dateKey).filter((key): key is string => key !== null))].sort().reverse()
  if (keys.length === 0) return { days: 0, last: null }
  if (todayKey === null || (keys[0] !== todayKey && keys[0] !== dayBefore(todayKey))) return { days: 0, last: keys[0] }

  let days = 1
  for (let i = 1; i < keys.length; i += 1) {
    if (keys[i] !== dayBefore(keys[i - 1])) break
    days += 1
  }

  return { days, last: keys[0] }
}

function asDifficulty(value: number | null | undefined): Difficulty {
  if (typeof value !== 'number' || !Number.isFinite(value)) return FALLBACK_DIFFICULTY
  return Math.min(5, Math.max(1, Math.round(value))) as Difficulty
}

// ---------------------------------------------------------------------------
// Compile
// ---------------------------------------------------------------------------

/**
 * Rebuilds the Learner State document from the server rows. The browser owns
 * this document: it recompiles after every attempt and writes back at
 * `version + 1`. Points, streaks and the integrity score are derived here,
 * never trusted from the previous document. The account status is not derived:
 * the server owns it, so a lifted restriction is not re-imposed by replaying
 * the events that caused it.
 */
export function compileLearnerState(
  profileRow: ProfileRow,
  masteryRows: MasteryRow[],
  attemptRows: AttemptRow[],
  eventRows: IntegrityEventRow[],
  wellnessRow: WellnessRow | null,
  prev?: Partial<LearnerState> | null,
  now: Date = new Date(),
): LearnerState {
  const userId = profileRow.id
  const todayKey = dateKey(now.toISOString())

  const mastery: Record<CloId, Mastery> = {}
  for (const row of masteryRows) {
    mastery[row.clo_id] = {
      userId,
      cloId: row.clo_id,
      score: row.score ?? 0,
      chain: row.chain ?? 0,
      patternsPassed: [...(row.patterns_passed ?? [])],
      closed: row.closed ?? false,
      lastAttemptAt: row.last_attempt_at ?? null,
    }
  }

  const points = attemptRows.reduce(
    (total, row) =>
      row.passed ? total + pointsForPass(asDifficulty(row.difficulty), row.hint_count ?? 0, row.quality ?? FALLBACK_QUALITY) : total,
    0,
  )

  const mistakes: MistakeRecord[] = attemptRows
    .filter((row) => !row.passed && typeof row.mistake_label === 'string' && row.mistake_label.length > 0)
    .map((row) => ({
      exerciseId: row.exercise_id,
      cloId: row.clo_id ?? '',
      pattern: row.pattern ?? '',
      label: row.mistake_label as string,
      at: row.created_at,
    }))

  const events = eventRows.map((row) => ({ type: row.type, exerciseId: row.exercise_id ?? null, createdAt: row.created_at }))
  const score = integrityScore(events, now)

  const exercise = streakOf(
    attemptRows.map((row) => row.created_at),
    todayKey,
  )
  const derot = streakOf(
    (wellnessRow?.drill_results ?? []).map((result) => result.at),
    todayKey,
  )

  return {
    userId,
    profile: {
      ...DEFAULT_LEARNER_PROFILE,
      ...prev?.profile,
      displayName: profileRow.display_name || prev?.profile?.displayName || DEFAULT_LEARNER_PROFILE.displayName,
    },
    currentCourse: prev?.currentCourse ?? null,
    path: [...(prev?.path ?? [])],
    nextExerciseIds: [...(prev?.nextExerciseIds ?? [])],
    mastery,
    recentMistakes: trimMistakes([...mistakes, ...(prev?.recentMistakes ?? [])]),
    streak: {
      exerciseDays: exercise.days,
      derotDays: derot.days,
      lastExerciseDate: exercise.last,
      lastDerotDate: derot.last,
    },
    points,
    integrityScore: score,
    accountStatus: profileRow.account_status ?? 'active',
    version: (prev?.version ?? 0) + 1,
    updatedAt: now.toISOString(),
  }
}
