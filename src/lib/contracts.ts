/**
 * BroGram shared contracts.
 *
 * This file is the seam between the Claude lane (agents, Learner State,
 * bank, scoring, tests) and the Astra lane (app shell, runtimes, screens,
 * backend, migrations). Both lanes import from `@/lib/contracts` which is a
 * verbatim copy of this file. Nobody edits it without telling the other lane.
 *
 * Rules encoded here are product decisions, not suggestions:
 *  - agents never talk to each other; they read Learner State and return a delta
 *  - the Coach can never return more than one line of code
 *  - the browser grades; the server stores and thinks
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export type Language = 'python' | 'javascript' | 'typescript' | 'web' | 'sql' | 'mongo' | 'java'
export type Runtime = 'browser' | 'judge'
export type Difficulty = 1 | 2 | 3 | 4 | 5
export type Tone = 'playful' | 'supportive' | 'tough-love' | 'direct'
export type Verbosity = 'short' | 'verbose'
export type LearningStyle = 'visual' | 'verbal' | 'mixed'

/** Pattern ids come from seed/patterns.json. Kept as string for forward-compat. */
export type PatternId = string
/** CLO ids look like "INFS1101-3". */
export type CloId = string
export type CourseCode = string

// ---------------------------------------------------------------------------
// Curriculum
// ---------------------------------------------------------------------------

export interface Course {
  code: CourseCode
  slug: string
  title: string
  language: Language
  secondaryLanguage?: Language
  runtime: Runtime
  level: number
  prerequisites: CourseCode[]
  topics: string[]
  cloIds: CloId[]
  status: 'live' | 'coming-soon'
  /** Pyodide packages to preload for this course. */
  packages?: string[]
}

export interface Clo {
  id: CloId
  course: CourseCode
  ordinal: number
  outcome: string
  topics: string[]
  prerequisites: CloId[]
  /** Patterns that make sense for this CLO. The bank query filters on these. */
  patterns: PatternId[]
  assessableInCode: boolean
}

// ---------------------------------------------------------------------------
// Exercise bank
// ---------------------------------------------------------------------------

export type ExerciseKind =
  | 'code' // write code that passes hidden tests
  | 'predict-output' // type what the snippet prints
  | 'spot-the-bug' // click the broken line
  | 'trace' // fill variable values at step N
  | 'schema' // design tables / classes; graded by structural checks

export interface TestCase {
  id: string
  /** Free-form input handed to the runner (stdin, function args as JSON, DOM fixture, SQL setup). */
  input: string
  /** Expected stdout / return / query result serialized as a string. */
  expected: string
  /** Hidden tests are never shown; visible ones appear as examples in the prompt. */
  hidden: boolean
  /** Optional human name shown on failure for visible tests only. */
  name?: string
}

export interface Exercise {
  id: string
  cloId: CloId
  language: Language
  kind: ExerciseKind
  difficulty: Difficulty
  pattern: PatternId
  title: string
  /** Markdown. Must state the task, constraints, and at least one visible example. */
  prompt: string
  starterCode: string
  tests: TestCase[]
  referenceSolution: string
  /** 'seed' = generated offline and committed; 'generated' = Author agent at runtime. */
  origin: 'seed' | 'generated'
  parentExerciseId?: string
  /** Free tags for retrieval (e.g. "strings", "off-by-one"). */
  tags: string[]
  /** Set by the exercise runner when a runtime needs extra setup (SQL schema, DOM html, mongo seed). */
  fixture?: string
}

/** What the browser bank query asks for. All fields optional except cloId. */
export interface BankQuery {
  cloId: CloId
  difficulty?: Difficulty
  /** Patterns the student has NOT yet passed for this CLO; the bank prefers these. */
  preferPatterns?: PatternId[]
  /** Patterns to exclude (e.g. the one just passed). */
  excludePatterns?: PatternId[]
  excludeExerciseIds?: string[]
  language?: Language
}

// ---------------------------------------------------------------------------
// Code execution (browser first, judge for Java)
// ---------------------------------------------------------------------------

export interface RunRequest {
  language: Language
  code: string
  tests: TestCase[]
  fixture?: string
  /** Hard wall-clock limit per test in ms. Browser runners must honor it via worker termination. */
  timeoutMs: number
  /** Pyodide packages to ensure loaded before running. */
  packages?: string[]
}

export interface TestResult {
  testId: string
  passed: boolean
  actual: string
  expected: string
  stdout: string
  stderr: string
  durationMs: number
  /** 'timeout' | 'runtime-error' | 'wrong-answer' | undefined when passed */
  failureKind?: 'timeout' | 'runtime-error' | 'wrong-answer' | 'compile-error'
}

export interface RunResult {
  ok: boolean
  results: TestResult[]
  passedCount: number
  totalCount: number
  /** Full stdout of a free run (no tests), used by the Run button. */
  stdout?: string
  stderr?: string
  runtime: Runtime
}

/** Every runtime adapter (pyodide, js, web, sql, mongo, judge) implements this. */
export interface RuntimeAdapter {
  language: Language
  /** Idempotent. Resolves when the runtime is ready (wasm loaded, worker spawned). */
  warmup(): Promise<void>
  run(req: RunRequest): Promise<RunResult>
  /** Abort the current run; must resolve the pending run() with timeout failures. */
  abort(): void
}

// ---------------------------------------------------------------------------
// Attempts, mastery, integrity
// ---------------------------------------------------------------------------

export interface Attempt {
  id: string
  userId: string
  exerciseId: string
  code: string
  results: TestResult[]
  passed: boolean
  durationMs: number
  hintCount: number
  createdAt: string // ISO
}

export interface Mastery {
  userId: string
  cloId: CloId
  /** 0..100 */
  score: number
  /** Consecutive passes with distinct patterns; CLO closes at 3. Resets to 0 on any fail. */
  chain: number
  /** Distinct patterns passed for this CLO, ever. */
  patternsPassed: PatternId[]
  closed: boolean
  lastAttemptAt: string | null
}

export type IntegrityEventType = 'blur' | 'idle' | 'paste-blocked' | 'copy-blocked' | 'printscreen' | 'contextmenu-blocked'

export interface IntegrityEvent {
  id: string
  userId: string
  type: IntegrityEventType
  exerciseId: string | null
  /** True when an attempt was in progress (editor focused, not yet submitted). */
  duringAttempt: boolean
  createdAt: string
}

/** Weights are product decisions. Idle is logged but never scored. */
export const INTEGRITY_WEIGHTS: Record<IntegrityEventType, number> = {
  'paste-blocked': 2,
  'copy-blocked': 2,
  printscreen: 3,
  blur: 1,
  'contextmenu-blocked': 0,
  idle: 0,
}

export const INTEGRITY_THRESHOLDS = {
  windowDays: 7,
  warnAt: 10,
  restrictAt: 20,
  banAt: 40,
  /** Paste attempts inside ONE exercise that trigger an instant 24h restriction. */
  instantRestrictPasteCount: 5,
  restrictHours: 24,
} as const

export type AccountStatus = 'active' | 'warned' | 'restricted' | 'banned'

// ---------------------------------------------------------------------------
// Learner State: the one document every agent reads
// ---------------------------------------------------------------------------

export interface MistakeRecord {
  exerciseId: string
  cloId: CloId
  pattern: PatternId
  /** One-line classification written by the Diagnoser, e.g. "off-by-one in range()". */
  label: string
  at: string
}

export interface LearnerProfile {
  displayName: string
  learningStyle: LearningStyle
  /** 0..1 each; from the Profiler. */
  styleVector: { visual: number; verbal: number; example: number; theory: number }
  tone: Tone
  verbosity: Verbosity
  motivation: {
    why: string
    beyondCourses: boolean
    depth: 'pass' | 'understand' | 'master'
    wantsAgenticCoding: boolean
  }
  onboardingComplete: boolean
}

export interface LearnerState {
  userId: string
  profile: LearnerProfile
  currentCourse: CourseCode | null
  /** Ordered path from the Planner. */
  path: CloId[]
  /** Next exercises the Planner picked from the bank; the UI shows these three. */
  nextExerciseIds: string[]
  mastery: Record<CloId, Mastery>
  /** Most recent first, max 10. Trimmed oldest-first when a prompt budget is exceeded. */
  recentMistakes: MistakeRecord[]
  streak: { exerciseDays: number; derotDays: number; lastExerciseDate: string | null; lastDerotDate: string | null }
  points: number
  integrityScore: number
  accountStatus: AccountStatus
  /** Increment on every write. Agents receive it and echo it so stale deltas are rejected. */
  version: number
  updatedAt: string
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export type AgentName = 'profiler' | 'planner' | 'author' | 'diagnoser' | 'coach' | 'reviewer' | 'buddy'

/** Max prompt tokens per agent. Enforced by the route before calling DeepSeek. */
export const AGENT_TOKEN_BUDGETS: Record<AgentName, number> = {
  profiler: 2000,
  planner: 2000,
  buddy: 2000,
  author: 4000,
  diagnoser: 8000,
  coach: 8000,
  reviewer: 8000,
}
export const AGENT_HARD_CEILING = 12000

/** The only seven triggers that may cause an agent call. Anything else is a bug. */
export type AgentTrigger =
  | 'onboarding-answer' // Profiler
  | 'plan-refresh' // Planner: onboarding done, CLO closed, course switched
  | 'bank-miss' // Author
  | 'attempt-failed' // Diagnoser
  | 'hint-requested' // Coach; counted separately for rate limiting
  | 'attempt-passed' // Reviewer
  | 'buddy-message' // Buddy

/** What the client may read from the bank: an Exercise without the reference solution. Row mapper lives in lib/learner/bank.ts. */
export type ExercisePublic = Omit<Exercise, 'referenceSolution'>

export interface AgentRequestBase {
  agent: AgentName
  trigger: AgentTrigger
  /** The slice of Learner State this agent is allowed to see. The route never sends more. */
  state: Partial<LearnerState> & { userId: string; version: number }
}

export interface ProfilerRequest extends AgentRequestBase {
  agent: 'profiler'
  phase: 1 | 2
  answers: { questionId: string; answer: string }[]
}
export interface ProfilerReply {
  nextQuestion: { id: string; text: string; options: string[] } | null
  /** motivation arrives one field per turn; the client merges keys, never replaces the object. */
  profileDelta: Partial<Omit<LearnerProfile, 'motivation'>> & { motivation?: Partial<LearnerProfile['motivation']> }
  done: boolean
}

export interface PlannerRequest extends AgentRequestBase {
  agent: 'planner'
  course: CourseCode
  clos: Clo[]
  /** Candidate exercises the client pre-fetched from the bank so the Planner picks, never invents. */
  candidates: Pick<Exercise, 'id' | 'cloId' | 'pattern' | 'difficulty' | 'title'>[]
}
export interface PlannerReply {
  path: CloId[]
  nextExerciseIds: string[]
  /** One sentence the dashboard shows. */
  focus: string
}

export interface AuthorRequest extends AgentRequestBase {
  agent: 'author'
  clo: Clo
  language: Language
  kind: ExerciseKind
  difficulty: Difficulty
  pattern: PatternId
  /** Ids of two bank exercises to use as style examples. The route loads them (with reference solutions) server-side. */
  exampleIds: string[]
  /** Id of the exercise being varied, if any. The route loads it server-side; the reply's pattern must differ from its pattern. */
  parentExerciseId?: string
}
export interface AuthorReply {
  exercise: Omit<Exercise, 'id' | 'origin' | 'parentExerciseId'>
}

export interface DiagnoserRequest extends AgentRequestBase {
  agent: 'diagnoser'
  exercise: Pick<Exercise, 'id' | 'cloId' | 'pattern' | 'prompt' | 'language' | 'kind'>
  code: string
  results: TestResult[]
}
export interface DiagnoserReply {
  /** "Here is what I think you were going for." */
  intent: string
  rootCause: string
  /** Label stored into recentMistakes. */
  mistakeLabel: string
  /** 3 to 6 steps, each one sentence, no code. */
  fixPlan: string[]
}

export interface CoachRequest extends AgentRequestBase {
  agent: 'coach'
  exercise: Pick<Exercise, 'id' | 'cloId' | 'pattern' | 'prompt' | 'language'>
  /** Unified diff of the editor since the last hint (or since the failed submission). */
  diffSinceLastHint: string
  currentCode: string
  fixPlan: string[]
  hintsSoFar: string[]
}
export interface CoachReply {
  hint: string
  /** At most ONE line, optional. Schema-enforced: no newline, max 80 chars. */
  codeLine?: string
  /** Which fix-plan step this hint points at (1-based). */
  planStep: number
}

export interface ReviewerRequest extends AgentRequestBase {
  agent: 'reviewer'
  /** The client never holds the reference solution; the route loads it by id with the service key and adds it to the prompt. */
  exercise: Pick<Exercise, 'id' | 'cloId' | 'pattern' | 'prompt' | 'language'>
  code: string
  hintCount: number
  durationMs: number
}
export interface ReviewerReply {
  improvements: [string, string]
  /** 0..100 quality of the passing solution; feeds score delta. */
  quality: number
  praise: string
}

export interface BuddyRequest extends AgentRequestBase {
  agent: 'buddy'
  /** Last 6 messages, oldest first. */
  messages: { role: 'user' | 'assistant'; content: string }[]
}
export interface BuddyReply {
  onTopic: boolean
  reply: string
  /** Optional nudge, e.g. { kind: 'derot', drill: 'trace' } */
  suggestion?: { kind: 'exercise' | 'derot' | 'break'; ref: string }
}

export type AgentRequest =
  | ProfilerRequest
  | PlannerRequest
  | AuthorRequest
  | DiagnoserRequest
  | CoachRequest
  | ReviewerRequest
  | BuddyRequest

export type AgentReplyOf<A extends AgentName> = A extends 'profiler'
  ? ProfilerReply
  : A extends 'planner'
    ? PlannerReply
    : A extends 'author'
      ? AuthorReply
      : A extends 'diagnoser'
        ? DiagnoserReply
        : A extends 'coach'
          ? CoachReply
          : A extends 'reviewer'
            ? ReviewerReply
            : BuddyReply

/** Envelope returned by POST /api/agent (and as the terminal SSE frame for streaming agents). */
export interface AgentEnvelope<R> {
  ok: true
  agent: AgentName
  reply: R
  usage: { promptTokens: number; completionTokens: number; cacheHitTokens: number }
  /** True when the reply is the safe fallback because DeepSeek returned invalid JSON twice (or once, for streaming agents). */
  fallback: boolean
}

/**
 * Streaming wire format (coach, diagnoser, buddy) when the client sends `Accept: text/event-stream`:
 *   data: {"partial": <Partial<Reply>>}   zero or more, from the provider's partial-object stream
 *   data: {"envelope": <AgentEnvelope<Reply> | AgentError>}   exactly one, always last
 * The client renders partials optimistically and, on the terminal frame, discards them and commits only the envelope.
 * AGENT_DRY_RUN emits the same two frame kinds so tests exercise the identical path.
 */
export type AgentStreamFrame<R> = { partial: Partial<R> } | { envelope: AgentEnvelope<R> | AgentError }
export interface AgentError {
  ok: false
  agent: AgentName
  error: 'rate-limited' | 'budget-exceeded' | 'upstream' | 'invalid-request' | 'banned'
  message: string
}

// ---------------------------------------------------------------------------
// De-rot drills
// ---------------------------------------------------------------------------

export type DrillKind = 'predict-output' | 'spot-the-bug' | 'trace' | 'hold-focus' | 'n-back' | 'speed-type'

export interface DrillItem {
  id: string
  kind: DrillKind
  language?: Language
  difficulty: Difficulty
  /** Kind-specific payload; see docs/superpowers/specs for shapes. */
  payload: Record<string, unknown>
  /** Seconds allowed. */
  timeLimitS: number
}

export interface DrillResult {
  drillId: string
  kind: DrillKind
  correct: boolean
  timeMs: number
  score: number
  at: string
}

// ---------------------------------------------------------------------------
// Wellness
// ---------------------------------------------------------------------------

export interface WellnessPrefs {
  prayerReminders: { fajr: boolean; dhuhr: boolean; asr: boolean; maghrib: boolean; isha: boolean }
  prayerLeadMinutes: number
  waterIntervalMin: number
  stretchIntervalMin: number
  pomodoroWorkMin: number
  pomodoroBreakMin: number
  useDeviceLocation: boolean
}

export const DEFAULT_WELLNESS: WellnessPrefs = {
  prayerReminders: { fajr: true, dhuhr: true, asr: true, maghrib: true, isha: true },
  prayerLeadMinutes: 10,
  waterIntervalMin: 45,
  stretchIntervalMin: 45,
  pomodoroWorkMin: 25,
  pomodoroBreakMin: 5,
  useDeviceLocation: false,
}

// ---------------------------------------------------------------------------
// Lockdown
// ---------------------------------------------------------------------------

export const LOCKDOWN = {
  /** Seconds of no keyboard/mouse input on an exercise screen before the blur overlay. */
  idleBlurAfterS: 15,
  /** Idle longer than this is logged (still weight 0). */
  idleLogAfterS: 60,
  /** Minimum seconds between Coach hints. */
  hintCooldownS: 60,
  /** Max hints per exercise. */
  maxHintsPerExercise: 5,
} as const

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** Points for a pass. Product decision; tests pin these numbers. */
export function pointsForPass(difficulty: Difficulty, hintCount: number, quality: number): number {
  const base = difficulty * 100
  const hintPenalty = Math.min(hintCount, 5) * 10
  const qualityBonus = Math.round((quality / 100) * 50)
  return Math.max(10, base - hintPenalty + qualityBonus)
}

/** Mastery score update on pass / fail. */
export function nextMasteryScore(current: number, passed: boolean, difficulty: Difficulty): number {
  const delta = passed ? 8 + difficulty * 2 : -5
  return Math.max(0, Math.min(100, current + delta))
}
