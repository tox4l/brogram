/**
 * Fixture data for the /preview gallery. Nothing here touches Supabase or an
 * agent; every value is hand-written or read from committed seed files (clos
 * and drills only) so every screen has something rich to show even though
 * the dev server's NEXT_PUBLIC_SUPABASE_URL is a placeholder and every real
 * fetch fails.
 *
 * V1 (Critical, Wave 2 review §5): this module never imports a seed
 * *exercise* file (seed/exercises/*.json). This page is a 'use client'
 * component, so any module it imports ships in the browser bundle whole --
 * reading only a couple of fields back out of an imported JSON object does
 * not stop the rest of that object's content from being emitted too. Every
 * seed exercise carries the model answer and every hidden test's real
 * answer alongside the fields a gallery actually needs, so importing one at
 * all -- even to read just `.title` -- shipped 43 model answers and 180
 * hidden-test answers into an unauthenticated production chunk. The
 * exercise fixtures below are hand-copied instead: real prompt/starter/
 * visible-test text (a learner already sees all of that in the product),
 * with every hidden test's own fields redacted to a placeholder, and no
 * model-answer field at all -- provably secret-free by construction, not by
 * a runtime pick. See fixtures.test.ts and
 * scripts/check-bundle-budget.mjs's scanForSecrets() for the two halves of
 * the guard against a regression.
 */
import type { User } from '@supabase/supabase-js'
import type {
  AgentName, Attempt, Clo, CoachReply, DiagnoserReply, DrillItem, DrillKind, DrillResult,
  ExercisePublic, LearnerState, TestResult,
} from '@/lib/contracts'
import type { SessionData, SessionProfile } from '@/store/session'
import type { AgentUsageRow, BankStatRow, CloRef, InviteRow, UserRow } from '@/components/admin/types'
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

// Hand-copied from seed/exercises/smoke.json's "First late train" (id
// smoke-first-late-train): prompt, starter code and the two visible tests
// are real (a learner sees exactly this much of the real exercise already).
// The four hidden tests carry no real input or answer -- see the module
// header -- and PromptPanel/ResultsPanel never read a hidden test's own
// fields (fixtures.test.ts pins that), so a placeholder is all a hidden row
// needs to be for this gallery.
export const fixtureCodeExercise: ExercisePublic = {
  id: 'smoke-first-late-train',
  cloId: 'INFS1101-3',
  language: 'python',
  kind: 'code',
  difficulty: 2,
  pattern: 'early-return',
  title: 'First late train',
  prompt: 'A station logs the minutes past the hour at which trains arrived. A train is late if it arrived after the limit.\n\nWrite `first_late(times, limit)` that returns the first arrival time that is greater than `limit`. If no train is late, return `-1`.\n\nExample: `first_late([3, 5, 9], 6)` returns `9`. `first_late([1, 2], 10)` returns `-1`.',
  starterCode: 'def first_late(times, limit):\n    pass\n',
  tests: [
    { id: 't1', input: '[[3,5,9],6]', expected: '9', hidden: false, name: 'example' },
    { id: 't2', input: '[[1,2],10]', expected: '-1', hidden: false, name: 'none late' },
    { id: 't3', input: '(redacted)', expected: '(redacted)', hidden: true },
    { id: 't4', input: '(redacted)', expected: '(redacted)', hidden: true },
    { id: 't5', input: '(redacted)', expected: '(redacted)', hidden: true },
    { id: 't6', input: '(redacted)', expected: '(redacted)', hidden: true },
  ],
  origin: 'seed',
  tags: ['loops', 'lists'],
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

// Hand-copied from seed/exercises/INFS1101.json's "Arcade Token Total"
// (kind predict-output). Same redaction rule as fixtureCodeExercise above.
export const fixturePredictExercise: ExercisePublic = {
  id: 'infs1101-predict-output-1',
  cloId: 'INFS1101-1',
  language: 'python',
  kind: 'predict-output',
  difficulty: 2,
  pattern: 'predict-output',
  title: 'Arcade Token Total',
  prompt: 'At Fun Zone Arcade, a token machine adds up the value of every token a player feeds in before it prints the total credit to the screen. Example: feeding in tokens worth 10 and 5 would print 15.\n\nRead the program below by hand and work out exactly what value it prints for the tokens actually listed; do not guess.\n\n```python\ntokens = [25, 10, 10, 5]\ntotal = 0\nfor value in tokens:\n    total += value\nprint(total)\n```\n\nType the number this program prints. Give only the digits, no extra words.',
  starterCode: '# Read-only: figure out what this prints, then answer.\ntokens = [25, 10, 10, 5]\ntotal = 0\nfor value in tokens:\n    total += value\nprint(total)\n',
  tests: [
    { id: 't1', input: '', expected: '50', hidden: false, name: 'example' },
    { id: 't2', input: '', expected: '50', hidden: false, name: 'check' },
    { id: 't3', input: '(redacted)', expected: '(redacted)', hidden: true },
    { id: 't4', input: '(redacted)', expected: '(redacted)', hidden: true },
    { id: 't5', input: '(redacted)', expected: '(redacted)', hidden: true },
    { id: 't6', input: '(redacted)', expected: '(redacted)', hidden: true },
  ],
  origin: 'seed',
  tags: ['loops', 'accumulation', 'reading'],
}

// Hand-copied from seed/exercises/INFS1101.json's "Kiosk Pricing Mistake"
// (kind spot-the-bug). Same redaction rule as fixtureCodeExercise above.
export const fixtureSpotBugExercise: ExercisePublic = {
  id: 'infs1101-spot-the-bug-1',
  cloId: 'INFS1101-1',
  language: 'python',
  kind: 'spot-the-bug',
  difficulty: 4,
  pattern: 'spec-to-steps',
  title: 'Kiosk Pricing Mistake',
  prompt: "A print shop's photo kiosk should total each order the same way: multiply the quantity by $0.20 per print; if that order is for 50 prints or more, take 10% off the print cost; then add a flat $1.00 processing fee; finally round the result to the nearest cent. Example: an order of 12 prints costs 12 times $0.20, which is $2.40; since 12 is under 50 prints no discount applies, so the fee makes the final total $3.40.\n\nSomeone turned that rule into the four numbered steps below and ran them over today's orders, but one step does not match the rule.\n\n```python\norders = [12, 50, 80, 3]\ntotals = []\nfor quantity in orders:\n    # step 1\n    cost = quantity * 0.20\n    # step 2\n    if quantity > 50:\n        cost = cost * 0.90\n    # step 3\n    cost = cost + 1.00\n    # step 4\n    totals.append(round(cost, 2))\n```\n\nWhich step number contradicts the rule? Answer with just that one digit.",
  starterCode: '# Read-only: find the step that breaks the rule, then answer.\norders = [12, 50, 80, 3]\ntotals = []\nfor quantity in orders:\n    # step 1\n    cost = quantity * 0.20\n    # step 2\n    if quantity > 50:\n        cost = cost * 0.90\n    # step 3\n    cost = cost + 1.00\n    # step 4\n    totals.append(round(cost, 2))\n',
  tests: [
    { id: 't1', input: '', expected: '2', hidden: false, name: 'example' },
    { id: 't2', input: '', expected: '2', hidden: false, name: 'check' },
    { id: 't3', input: '(redacted)', expected: '(redacted)', hidden: true },
    { id: 't4', input: '(redacted)', expected: '(redacted)', hidden: true },
    { id: 't5', input: '(redacted)', expected: '(redacted)', hidden: true },
    { id: 't6', input: '(redacted)', expected: '(redacted)', hidden: true },
  ],
  origin: 'seed',
  tags: ['conditionals', 'off-by-one', 'pricing'],
}

// The shipped bank holds no trace exercise any more (the three single-value ones became
// predict-output), so the gallery carries its own: a real variables map, as the validator now
// requires for the kind. cloId/language match seed/exercises/INFS1101.json's exercises[0].
export const fixtureTraceExercise: ExercisePublic = {
  id: 'infs1101-trace-1',
  cloId: 'INFS1101-1',
  language: 'python',
  kind: 'trace',
  difficulty: 2,
  pattern: 'trace',
  title: 'Drone Battery Checkpoint',
  prompt: 'Trace the loop and write the final value of each variable.',
  starterCode: 'battery = 100\ncheckpoint = 0\nfor leg in [10, 15, 5]:\n    battery -= leg\n    checkpoint += 1\n',
  tests: [{ id: 't1', input: '', expected: '{"battery": 70, "checkpoint": 3}', hidden: false }],
  origin: 'seed',
  tags: ['loops', 'variables'],
}
export const fixtureTraceVariables = ['battery', 'checkpoint']

// Hand-copied from seed/exercises/INFS2201.json's "Podcast shows and
// episodes" (kind schema). Same redaction rule as fixtureCodeExercise above.
export const fixtureSchemaExercise: ExercisePublic = {
  id: 'infs2201-schema-1',
  cloId: 'INFS2201-2',
  language: 'sql',
  kind: 'schema',
  difficulty: 2,
  pattern: 'schema-design',
  title: 'Podcast shows and episodes',
  prompt: "A podcast network tracks shows and the episodes that belong to them. Each show can have many episodes, but every episode belongs to exactly one show.\n\nWrite the `CREATE TABLE` statements for `shows` and `episodes` so the relationship is modeled correctly.\n\nRequirements:\n- `shows`: `id` (integer, primary key), `title` (text, required).\n- `episodes`: `id` (integer, primary key), `show_id` (integer, required, references `shows.id`), `title` (text, required), `episode_number` (integer, required).\n- Every episode must point at a real show, and a show may have any number of episodes, including none.\n\nExample: after creating the tables, inserting show `(1, 'Night Shift')` and episode `(1, 1, 'Pilot', 1)`, selecting `show_id, title, episode_number` from `episodes` returns one row: `1, 'Pilot', 1`.",
  starterCode: '-- create the `shows` and `episodes` tables below\n-- shows: id, title\n-- episodes: id, show_id, title, episode_number\n',
  tests: [
    { id: 't1', input: "insert into shows values (1,'Night Shift');\ninsert into episodes values (1,1,'Pilot',1);\nselect show_id, title, episode_number from episodes;", expected: '{"columns":["show_id","title","episode_number"],"values":[[1,"Pilot",1]]}', hidden: false, name: 'example' },
    { id: 't2', input: "insert into shows values (1,'Night Shift'),(2,'Quiet Room');\ninsert into episodes values (1,1,'Pilot',1),(2,2,'Intro',1);\nselect s.title as show_title, e.title as episode_title from shows s join episodes e on e.show_id = s.id order by s.id;", expected: '{"columns":["show_title","episode_title"],"values":[["Night Shift","Pilot"],["Quiet Room","Intro"]]}', hidden: false, name: 'join across shows' },
    { id: 't3', input: '(redacted)', expected: '(redacted)', hidden: true },
    { id: 't4', input: '(redacted)', expected: '(redacted)', hidden: true },
    { id: 't5', input: '(redacted)', expected: '(redacted)', hidden: true },
    { id: 't6', input: '(redacted)', expected: '(redacted)', hidden: true },
  ],
  origin: 'seed',
  tags: ['foreign-key', 'one-to-many', 'keys'],
}

// ---------------------------------------------------------------------------
// De-rot: one item per kind
// ---------------------------------------------------------------------------

/** Seed drill json predates the `lane` field; every seed drill is an Arcade kind, so it is stamped on here. */
function arcadeDrillItem(raw: unknown): DrillItem {
  return { ...(raw as unknown as DrillItem), lane: 'arcade' }
}

/** Playground kinds have no seed data yet (Wave 2 builds the games); a minimal honest placeholder item
 * is enough for DrillRunner's "coming in the next update" placeholder to render in the gallery. */
function playDrillItem(kind: DrillKind, id: string): DrillItem {
  return { id, kind, difficulty: 3, timeLimitS: 60, payload: {}, lane: 'play' }
}

export const fixtureDrillItems: Record<DrillKind, DrillItem> = {
  'predict-output': arcadeDrillItem(predictOutputDrills.items[5]),
  'spot-the-bug': arcadeDrillItem(spotTheBugDrills.items[4]),
  trace: arcadeDrillItem(traceDrills.items[5]),
  'hold-focus': arcadeDrillItem(holdFocusDrills.items[2]),
  'n-back': arcadeDrillItem(nBackDrills.items[2]),
  'speed-type': arcadeDrillItem(speedTypeDrills.items[2]),
  'follow-the-dot': playDrillItem('follow-the-dot', 'follow-the-dot-preview'),
  'color-nback': playDrillItem('color-nback', 'color-nback-preview'),
  reaction: playDrillItem('reaction', 'reaction-preview'),
  rhythm: playDrillItem('rhythm', 'rhythm-preview'),
  breathe: playDrillItem('breathe', 'breathe-preview'),
  'memory-grid': playDrillItem('memory-grid', 'memory-grid-preview'),
}

export const DRILL_KINDS: DrillKind[] = ['predict-output', 'spot-the-bug', 'trace', 'hold-focus', 'n-back', 'speed-type']
export const DRILL_KIND_LABELS: Record<DrillKind, string> = {
  'predict-output': 'Predict output',
  'spot-the-bug': 'Spot the bug',
  trace: 'Trace',
  'hold-focus': 'Hold focus',
  'n-back': 'N-back',
  'speed-type': 'Speed type',
  'follow-the-dot': 'Follow the Dot',
  'color-nback': 'Colour Back',
  reaction: 'Twitch',
  rhythm: 'Keep Time',
  breathe: 'Breathe',
  'memory-grid': 'Grid',
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
    lane: 'arcade' as const,
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
