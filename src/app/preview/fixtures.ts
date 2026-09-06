/**
 * Fixture data for the /preview gallery. Nothing here touches Supabase or an
 * agent; every value is hand-written or read from the committed seed files so
 * every screen has something rich to show even though the dev server's
 * NEXT_PUBLIC_SUPABASE_URL is a placeholder and every real fetch fails.
 */
import type { User } from '@supabase/supabase-js'
import type {
  AgentName, Attempt, Clo, CoachReply, DiagnoserReply, DrillItem, DrillKind, DrillResult,
  ExercisePublic, LearnerState, TestResult,
} from '@/lib/contracts'
import type { SessionData, SessionProfile } from '@/store/session'
import type { AgentUsageRow, BankStatRow, CloRef, InviteRow, UserRow } from '@/components/admin/types'
import smokeSeed from '../../../seed/exercises/smoke.json'
import infs1101Seed from '../../../seed/exercises/INFS1101.json'
import infs2201Seed from '../../../seed/exercises/INFS2201.json'
import closSeed from '../../../seed/clos.json'
import predictOutputDrills from '../../../seed/drills/predict-output.json'
import spotTheBugDrills from '../../../seed/drills/spot-the-bug.json'
import traceDrills from '../../../seed/drills/trace.json'
import holdFocusDrills from '../../../seed/drills/hold-focus.json'
import nBackDrills from '../../../seed/drills/n-back.json'
import speedTypeDrills from '../../../seed/drills/speed-type.json'

// A fixed "now" so every relative date in the gallery (streaks, attempt
// history, agent usage) is deterministic across renders and test runs.
const NOW = new Date('2026-09-06T09:00:00.000Z')
const isoDaysAgo = (days: number, hour = 9) => {
  const d = new Date(NOW)
  d.setUTCDate(d.getUTCDate() - days)
  d.setUTCHours(hour, 0, 0, 0)
  return d.toISOString()
}
const dateKeyDaysAgo = (days: number) => isoDaysAgo(days).slice(0, 10)

export const FIXTURE_USER_ID = 'preview-000-learner'

// ---------------------------------------------------------------------------
// Session: user, profile, and a rich LearnerState
// ---------------------------------------------------------------------------

export const fixtureUser = { id: FIXTURE_USER_ID, email: 'preview@brogram.dev' } as unknown as User

export const fixtureProfile: SessionProfile = {
  id: FIXTURE_USER_ID,
  account_status: 'active',
  restricted_until: null,
}

/** `focus` rides along as an extra jsonb key, same as the real Planner output (see dashboard/page.tsx). */
export const fixtureLearnerState: LearnerState & { focus: string } = {
  userId: FIXTURE_USER_ID,
  profile: {
    displayName: 'Noor',
    learningStyle: 'mixed',
    styleVector: { visual: 0.6, verbal: 0.4, example: 0.7, theory: 0.3 },
    tone: 'supportive',
    verbosity: 'short',
    motivation: { why: 'I want to build my own small tools.', beyondCourses: true, depth: 'understand', wantsAgenticCoding: true },
    onboardingComplete: true,
  },
  currentCourse: 'INFS1101',
  path: ['INFS1101-1', 'INFS1101-2', 'INFS1101-3', 'INFS1101-4'],
  nextExerciseIds: ['infs1101-guard-1', 'infs1101-accumulate-1', 'infs1101-early-return-1'],
  mastery: {
    'INFS1101-1': { userId: FIXTURE_USER_ID, cloId: 'INFS1101-1', score: 100, chain: 3, patternsPassed: ['trace', 'predict-output', 'spec-to-steps'], closed: true, lastAttemptAt: isoDaysAgo(6) },
    'INFS1101-2': { userId: FIXTURE_USER_ID, cloId: 'INFS1101-2', score: 62, chain: 1, patternsPassed: ['accumulate'], closed: false, lastAttemptAt: isoDaysAgo(2) },
    'INFS1101-3': { userId: FIXTURE_USER_ID, cloId: 'INFS1101-3', score: 40, chain: 0, patternsPassed: ['guard'], closed: false, lastAttemptAt: isoDaysAgo(1) },
    'INFS1101-4': { userId: FIXTURE_USER_ID, cloId: 'INFS1101-4', score: 0, chain: 0, patternsPassed: [], closed: false, lastAttemptAt: null },
  },
  recentMistakes: [
    { exerciseId: 'infs1101-guard-1', cloId: 'INFS1101-3', pattern: 'guard', label: 'off-by-one at the boundary (>= instead of >)', at: isoDaysAgo(1) },
    { exerciseId: 'infs1101-nested-loop-1', cloId: 'INFS1101-3', pattern: 'nested-loop', label: 'inner loop never resets between passes', at: isoDaysAgo(3) },
    { exerciseId: 'infs1101-accumulate-2', cloId: 'INFS1101-2', pattern: 'accumulate', label: 'accumulator initialized inside the loop', at: isoDaysAgo(4) },
  ],
  streak: { exerciseDays: 8, derotDays: 3, lastExerciseDate: dateKeyDaysAgo(0), lastDerotDate: dateKeyDaysAgo(1) },
  points: 1240,
  integrityScore: 4,
  accountStatus: 'active',
  version: 14,
  updatedAt: isoDaysAgo(0),
  focus: 'Keep practicing selection and loops before moving on to strings and functions.',
}

export const fixtureSessionData: SessionData = {
  user: fixtureUser,
  profile: fixtureProfile,
  learnerState: fixtureLearnerState,
}

// ---------------------------------------------------------------------------
// Dashboard: current course, next three exercises, mastery outcomes
// ---------------------------------------------------------------------------

export const fixtureCourse = { code: 'INFS1101', title: 'Intro to Computing & Problem Solving', language: 'python' }

export interface FixtureOutcome { id: string; ordinal: number; outcome: string; draft: boolean }
/** One outcome is flagged `draft` here purely to demonstrate the dashboard's "Draft outcome" marker;
 * INFS1101's real CLOs are not draft (only INFS1201's are, per seed/clos.json). */
export const fixtureOutcomes: FixtureOutcome[] = closSeed.clos
  .filter((clo) => clo.course === 'INFS1101')
  .map((clo) => ({ id: clo.id, ordinal: clo.ordinal, outcome: clo.outcome, draft: clo.id === 'INFS1101-4' }))

export interface FixtureExerciseSummary { id: string; title: string; difficulty: number; language: string; clo_id: string }
export const fixtureNextExercises: FixtureExerciseSummary[] = [
  { id: 'infs1101-guard-1', title: 'Airline Baggage Check', difficulty: 2, language: 'python', clo_id: 'INFS1101-3' },
  { id: 'infs1101-accumulate-1', title: 'Trail Elevation Gain', difficulty: 3, language: 'python', clo_id: 'INFS1101-3' },
  { id: 'infs1101-early-return-1', title: 'First Unsafe pH Reading', difficulty: 3, language: 'python', clo_id: 'INFS1101-3' },
]

// ---------------------------------------------------------------------------
// Exercise screen fixtures
// ---------------------------------------------------------------------------

const smokeCodeExercise = smokeSeed.exercises[0]
export const fixtureCodeExercise: ExercisePublic = {
  id: 'smoke-first-late-train',
  cloId: smokeCodeExercise.cloId,
  language: smokeCodeExercise.language as ExercisePublic['language'],
  kind: 'code',
  difficulty: smokeCodeExercise.difficulty as ExercisePublic['difficulty'],
  pattern: smokeCodeExercise.pattern,
  title: smokeCodeExercise.title,
  prompt: smokeCodeExercise.prompt,
  starterCode: smokeCodeExercise.starterCode,
  tests: smokeCodeExercise.tests as ExercisePublic['tests'],
  origin: 'seed',
  tags: smokeCodeExercise.tags,
}

export const fixtureClo: Clo = {
  id: 'INFS1101-3',
  course: 'INFS1101',
  ordinal: 3,
  outcome: closSeed.clos.find((clo) => clo.id === 'INFS1101-3')!.outcome,
  topics: ['selection', 'iteration'],
  prerequisites: ['INFS1101-2'],
  patterns: ['guard', 'accumulate', 'filter', 'nested-loop', 'early-return', 'boundary', 'state-machine'],
  assessableInCode: true,
}

/** A wrong attempt: uses `>=` instead of `>`, the classic boundary bug for "late" meaning strictly after the limit. */
export const fixtureWrongAttempt = `def first_late(times, limit):
    for t in times:
        if t >= limit:
            return t
    return -1
`

export const fixtureResults: TestResult[] = [
  { testId: 't1', passed: true, actual: '9', expected: '9', stdout: '', stderr: '', durationMs: 8 },
  { testId: 't2', passed: true, actual: '-1', expected: '-1', stdout: '', stderr: '', durationMs: 6 },
  { testId: 't3', passed: false, actual: '4', expected: '-1', stdout: '', stderr: '', durationMs: 7, failureKind: 'wrong-answer' },
  { testId: 't4', passed: false, actual: '7', expected: '-1', stdout: '', stderr: '', durationMs: 7, failureKind: 'wrong-answer' },
  { testId: 't5', passed: false, actual: '2', expected: '8', stdout: '', stderr: '', durationMs: 9, failureKind: 'wrong-answer' },
  { testId: 't6', passed: false, actual: '0', expected: '1', stdout: '', stderr: '', durationMs: 6, failureKind: 'wrong-answer' },
]

export const fixtureDiagnosis: DiagnoserReply = {
  intent: "You're looking for the first arrival time that is strictly after the limit.",
  rootCause: 'The comparison uses `>=` instead of `>`, so a train arriving exactly at the limit is incorrectly treated as late.',
  mistakeLabel: 'off-by-one at the boundary (>= instead of >)',
  fixPlan: [
    "Re-read the definition of 'late': strictly after the limit, not at or after it.",
    'Change the comparison from `t >= limit` to `t > limit`.',
    'Re-run the visible examples to confirm the early cases still pass.',
    'Check the boundary case where a time equals the limit exactly.',
  ],
}

export const fixtureHints: CoachReply[] = [
  { hint: 'Look closely at the comparison operator on the boundary case where a time equals the limit.', planStep: 2 },
]

export const fixtureHintCooldown = { available: false, waitSeconds: 42, count: 1 }
export const fixtureHintReady = { available: true, waitSeconds: 0, count: 1 }

const infs1101PredictOutput = infs1101Seed.exercises.find((exercise) => exercise.kind === 'predict-output')!
export const fixturePredictExercise: ExercisePublic = {
  id: 'infs1101-predict-output-1',
  cloId: infs1101PredictOutput.cloId,
  language: infs1101PredictOutput.language as ExercisePublic['language'],
  kind: 'predict-output',
  difficulty: infs1101PredictOutput.difficulty as ExercisePublic['difficulty'],
  pattern: infs1101PredictOutput.pattern,
  title: infs1101PredictOutput.title,
  prompt: infs1101PredictOutput.prompt,
  starterCode: infs1101PredictOutput.starterCode,
  tests: infs1101PredictOutput.tests as ExercisePublic['tests'],
  origin: 'seed',
  tags: infs1101PredictOutput.tags,
}

const infs1101SpotTheBug = infs1101Seed.exercises.find((exercise) => exercise.kind === 'spot-the-bug')!
export const fixtureSpotBugExercise: ExercisePublic = {
  id: 'infs1101-spot-the-bug-1',
  cloId: infs1101SpotTheBug.cloId,
  language: infs1101SpotTheBug.language as ExercisePublic['language'],
  kind: 'spot-the-bug',
  difficulty: infs1101SpotTheBug.difficulty as ExercisePublic['difficulty'],
  pattern: infs1101SpotTheBug.pattern,
  title: infs1101SpotTheBug.title,
  prompt: infs1101SpotTheBug.prompt,
  starterCode: infs1101SpotTheBug.starterCode,
  tests: infs1101SpotTheBug.tests as ExercisePublic['tests'],
  origin: 'seed',
  tags: infs1101SpotTheBug.tags,
}

const infs1101Trace = infs1101Seed.exercises.find((exercise) => exercise.kind === 'trace')!
export const fixtureTraceExercise: ExercisePublic = {
  id: 'infs1101-trace-1',
  cloId: infs1101Trace.cloId,
  language: infs1101Trace.language as ExercisePublic['language'],
  kind: 'trace',
  difficulty: infs1101Trace.difficulty as ExercisePublic['difficulty'],
  pattern: infs1101Trace.pattern,
  title: infs1101Trace.title,
  prompt: infs1101Trace.prompt,
  starterCode: infs1101Trace.starterCode,
  tests: infs1101Trace.tests as ExercisePublic['tests'],
  origin: 'seed',
  tags: infs1101Trace.tags,
}
export const fixtureTraceVariables = ['battery', 'checkpoint']

const infs2201Schema = infs2201Seed.exercises.find((exercise) => exercise.kind === 'schema')!
export const fixtureSchemaExercise: ExercisePublic = {
  id: 'infs2201-schema-1',
  cloId: infs2201Schema.cloId,
  language: infs2201Schema.language as ExercisePublic['language'],
  kind: 'schema',
  difficulty: infs2201Schema.difficulty as ExercisePublic['difficulty'],
  pattern: infs2201Schema.pattern,
  title: infs2201Schema.title,
  prompt: infs2201Schema.prompt,
  starterCode: infs2201Schema.starterCode,
  tests: infs2201Schema.tests as ExercisePublic['tests'],
  origin: 'seed',
  tags: infs2201Schema.tags,
}

// ---------------------------------------------------------------------------
// De-rot: one item per kind
// ---------------------------------------------------------------------------

export const fixtureDrillItems: Record<DrillKind, DrillItem> = {
  'predict-output': predictOutputDrills.items[5] as DrillItem,
  'spot-the-bug': spotTheBugDrills.items[4] as DrillItem,
  trace: traceDrills.items[5] as DrillItem,
  'hold-focus': holdFocusDrills.items[2] as DrillItem,
  'n-back': nBackDrills.items[2] as DrillItem,
  'speed-type': speedTypeDrills.items[2] as DrillItem,
}

export const DRILL_KINDS: DrillKind[] = ['predict-output', 'spot-the-bug', 'trace', 'hold-focus', 'n-back', 'speed-type']
export const DRILL_KIND_LABELS: Record<DrillKind, string> = {
  'predict-output': 'Predict output',
  'spot-the-bug': 'Spot the bug',
  trace: 'Trace',
  'hold-focus': 'Hold focus',
  'n-back': 'N-back',
  'speed-type': 'Speed type',
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export const fixtureReportClos: Clo[] = closSeed.clos
  .filter((clo) => clo.course === 'INFS1101')
  .map((clo) => ({
    id: clo.id,
    course: clo.course,
    ordinal: clo.ordinal,
    outcome: clo.outcome,
    topics: clo.topics,
    prerequisites: clo.prerequisites,
    patterns: clo.patterns,
    assessableInCode: clo.assessable_in_code,
  }))

const attemptPatterns: { exerciseId: string; cloId: string; pattern: string; passed: boolean; daysAgo: number; durationMs: number; hintCount: number }[] = [
  { exerciseId: 'infs1101-trace-seed', cloId: 'INFS1101-1', pattern: 'trace', passed: true, daysAgo: 13, durationMs: 240_000, hintCount: 0 },
  { exerciseId: 'infs1101-predict-seed', cloId: 'INFS1101-1', pattern: 'predict-output', passed: true, daysAgo: 12, durationMs: 180_000, hintCount: 0 },
  { exerciseId: 'infs1101-spec-seed', cloId: 'INFS1101-1', pattern: 'spec-to-steps', passed: true, daysAgo: 10, durationMs: 300_000, hintCount: 1 },
  { exerciseId: 'infs1101-accumulate-2', cloId: 'INFS1101-2', pattern: 'accumulate', passed: false, daysAgo: 8, durationMs: 420_000, hintCount: 2 },
  { exerciseId: 'infs1101-accumulate-1', cloId: 'INFS1101-2', pattern: 'accumulate', passed: true, daysAgo: 7, durationMs: 260_000, hintCount: 1 },
  { exerciseId: 'infs1101-guard-2', cloId: 'INFS1101-2', pattern: 'guard', passed: false, daysAgo: 6, durationMs: 200_000, hintCount: 0 },
  { exerciseId: 'infs1101-nested-loop-1', cloId: 'INFS1101-3', pattern: 'nested-loop', passed: false, daysAgo: 3, durationMs: 340_000, hintCount: 2 },
  { exerciseId: 'infs1101-guard-1', cloId: 'INFS1101-3', pattern: 'guard', passed: true, daysAgo: 1, durationMs: 220_000, hintCount: 1 },
  { exerciseId: 'infs1101-early-return-1', cloId: 'INFS1101-3', pattern: 'early-return', passed: false, daysAgo: 0, durationMs: 150_000, hintCount: 0 },
]

export const fixtureAttempts: Attempt[] = attemptPatterns.map((entry, index) => ({
  id: `preview-attempt-${index}`,
  userId: FIXTURE_USER_ID,
  exerciseId: entry.exerciseId,
  code: '# fixture attempt\n',
  results: [{ testId: 't1', passed: entry.passed, actual: entry.passed ? 'ok' : 'wrong', expected: 'ok', stdout: '', stderr: '', durationMs: 5 }],
  passed: entry.passed,
  durationMs: entry.durationMs,
  hintCount: entry.hintCount,
  createdAt: isoDaysAgo(entry.daysAgo, 10 + (index % 6)),
}))

const drillKindOrder: DrillKind[] = ['predict-output', 'spot-the-bug', 'trace', 'hold-focus', 'n-back', 'speed-type']
export const fixtureDrillResults: DrillResult[] = drillKindOrder.flatMap((kind, kindIndex) => (
  [0, 1, 2].map((run) => ({
    drillId: `${kind}-preview-${run}`,
    kind,
    correct: run !== 1,
    timeMs: 8_000 + run * 2_000 + kindIndex * 500,
    score: run === 1 ? 40 + kindIndex * 3 : 78 + run * 6 + kindIndex,
    at: isoDaysAgo(9 - kindIndex - run, 16),
  }))
))

export const fixtureReportGeneratedAt = isoDaysAgo(0, 9)
export const fixtureReportDisplayName = fixtureLearnerState.profile.displayName

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export const fixtureInvites: InviteRow[] = [
  { code: 'BRG-2K9F', email: 'sara.k@velocity.edu.qa', created_at: isoDaysAgo(1), redeemed_at: null, redeemed_by: null },
  { code: 'BRG-7Q1P', email: 'omar.h@velocity.edu.qa', created_at: isoDaysAgo(4), redeemed_at: isoDaysAgo(3), redeemed_by: 'user-omar' },
  { code: 'BRG-M4X8', email: 'huda.n@velocity.edu.qa', created_at: isoDaysAgo(9), redeemed_at: isoDaysAgo(8), redeemed_by: 'user-huda' },
  { code: 'BRG-T0Z2', email: 'ali.r@velocity.edu.qa', created_at: isoDaysAgo(12), redeemed_at: null, redeemed_by: null },
]

export const fixtureUsers: UserRow[] = [
  { id: 'user-noor', display_name: 'Noor', email: 'noor@velocity.edu.qa', account_status: 'active', restricted_until: null, integrity_score: 4, event_counts: { blur: 3, idle: 12 }, last_seen_at: isoDaysAgo(0), created_at: isoDaysAgo(30) },
  { id: 'user-omar', display_name: 'Omar', email: 'omar.h@velocity.edu.qa', account_status: 'warned', restricted_until: null, integrity_score: 14, event_counts: { blur: 6, 'paste-blocked': 3, idle: 5 }, last_seen_at: isoDaysAgo(1), created_at: isoDaysAgo(20) },
  { id: 'user-huda', display_name: 'Huda', email: 'huda.n@velocity.edu.qa', account_status: 'restricted', restricted_until: isoDaysAgo(-1), integrity_score: 24, event_counts: { 'paste-blocked': 6, printscreen: 1, blur: 9 }, last_seen_at: isoDaysAgo(2), created_at: isoDaysAgo(18) },
  { id: 'user-ali', display_name: 'Ali', email: 'ali.r@velocity.edu.qa', account_status: 'banned', restricted_until: null, integrity_score: 46, event_counts: { 'paste-blocked': 12, 'copy-blocked': 4, printscreen: 3, blur: 10 }, last_seen_at: isoDaysAgo(5), created_at: isoDaysAgo(40) },
]

export const fixtureCloRefs: CloRef[] = closSeed.clos.map((clo) => ({ id: clo.id, ordinal: clo.ordinal, course: clo.course, patterns: clo.patterns }))

export const fixtureBankStats: BankStatRow[] = fixtureCloRefs
  .filter((clo) => clo.course === 'INFS1101' || clo.course === 'INFS1201')
  .flatMap((clo) => clo.patterns.map((pattern, index) => ({
    clo_id: clo.id,
    pattern,
    seed_count: clo.course === 'INFS1201' ? 0 : 6 + index,
    generated_count: clo.course === 'INFS1201' ? 0 : 8 + index,
    verified_count: clo.course === 'INFS1201' ? 0 : 6 + index,
  })))

const AGENT_NAMES: AgentName[] = ['profiler', 'planner', 'author', 'diagnoser', 'coach', 'reviewer', 'buddy']
export const fixtureAgentUsage: AgentUsageRow[] = Array.from({ length: 14 }, (_, dayIndex) => dayIndex).flatMap((dayIndex) => (
  AGENT_NAMES.map((agent, agentIndex) => {
    const calls = 10 + agentIndex * 4 + (dayIndex % 5)
    const fallback = agentIndex === 3 ? Math.floor(calls / 8) : Math.floor(calls / 20)
    return {
      day: dateKeyDaysAgo(13 - dayIndex),
      agent,
      calls,
      fallback_calls: fallback,
      prompt_tokens: calls * (400 + agentIndex * 120),
      completion_tokens: calls * (120 + agentIndex * 30),
      cache_hit_tokens: calls * (150 + agentIndex * 20),
    }
  })
))
