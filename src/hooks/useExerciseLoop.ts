'use client'

import { startTransition, useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useRouter } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Attempt, BankQuery, Clo, CoachReply, DiagnoserReply, ExercisePublic, LearnerState, LessonProgress, Mastery, MotionPreference, PlannerReply, ReviewerReply, RunResult, TestResult, UserAchievement } from '@/lib/contracts'
import { LOCKDOWN, pointsForPass } from '@/lib/contracts'
import { callAgent, streamAgent } from '@/lib/agents/client'
import { DEFAULT_DIFFICULTY, fetchBank, pickFromBank, toExercisePublic } from '@/lib/learner/bank'
import { nextInChain } from '@/lib/learner/chain'
import { applyFail, applyPass } from '@/lib/learner/score'
import { provisionalPlan } from '@/lib/learner/provisional'
import type { WellnessRow } from '@/lib/learner/compile'
import { getRuntime, judgeProviderAbsent, subscribeRuntimeProgress, type RuntimeProgress } from '@/lib/runtimes'
import { createClient } from '@/lib/supabase/client'
import { codeDiff, exerciseRunRequest, gradeAnswer, usesAnswerForm } from '@/lib/exercise/grading'
import { useSession } from '@/store/session'
import { clo as staticClo, closFor, course as staticCourse, courses as staticCourses, exerciseFrom } from '@/lib/curriculum'
import { buildRewardContext, type RewardAttempt } from '@/lib/rewards/context'
import { recordAchievements, recordGoalDay } from '@/lib/rewards/record'
import { crossedMilestone } from '@/lib/rewards/streaks'
import { celebrate, levelUpDetail, type CelebrationDetail, type CelebrationKind } from '@/lib/rewards/useCelebration'
import { play } from '@/lib/sound/manager'
import { resolveWellnessPrefs } from '@/lib/wellness/prefs'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'
import { getQueryClient, onUserChange } from '@/lib/query/client'
import { qk } from '@/lib/query/keys'
import { line } from '@/lib/voice/lines'

/**
 * Fix round (web-runtime hang investigation): `next()`'s own comment originally assumed
 * `page.tsx`'s "no key={id}" means this hook's instance survives an in-place transition. It does
 * not, in the live App Router: navigating to a new `/exercise/<id>` value remounts
 * `useExerciseLoop` (confirmed with a DOM-identity probe against a real browser). A per-instance
 * `useRef` cannot hand anything to the fresh instance that replaces it -- refs die with their
 * component. The fix: survive the remount by holding the handoff at module scope, the same
 * pattern `src/lib/runtimes/index.ts`'s adapter registry already uses for the identical problem
 * (a singleton that must outlive any one component instance). Whoever resolves the next exercise
 * (originally only `next()`; `queueNext` too, as of fix round 5 below) stores it here; the *next*
 * mount effect to run for that exact exercise id -- whether it belongs to the same instance or a
 * freshly remounted one -- consumes it and calls `applyLoadedExercise` with the already-known data
 * instead of re-deriving it asynchronously. No network gap exists for a fresh instance to race
 * against, so there is nothing left to overwrite.
 *
 * Fix round 5 (T2.2 review of round 4, C1/I1/I2): round 4 replaced `next()`'s `router.replace()`
 * with `window.history.replaceState()` to stop the App Router from remounting this hook on an
 * in-place transition. That closed the remount, but bypassing the router left the ROUTE'S OWN
 * dynamic param permanently stale for the rest of the session -- `useLockdown` (`page.tsx`) reads
 * that param on every logged event, so every integrity event after rep 1 was filed under the
 * previous exercise (reproduced live, `integrity_events`); Back into the rep also restored the
 * previous exercise's route tree under the new URL (`app-router.js`'s `copyNextJsInternalHistoryState`
 * pairs a `replaceState`'d entry's new URL with the CURRENT tree, not one that matches it).
 *
 * Binding ruling: the router comes back. `next()` calls `router.replace(url)` again (below,
 * wrapped in React's `startTransition` so the resulting remount doesn't yank the UI to
 * `loading.tsx` while it resolves) -- params, history and the segment tree all stay correct,
 * closing C1 and the Back bug at once, and `pendingHandoff`'s `[exerciseId, reload]`-keyed
 * consumption (see its own comment) becomes reachable again since `exerciseId` genuinely changes.
 * The remount this causes is real and permanent (this tree's own Next docs prescribe the raw
 * History API specifically because a real navigation remounts a changed dynamic segment; there is
 * no supported way to update one without that) -- survivable because of `pendingSubmissions`
 * below, and made INVISIBLE rather than merely survivable: `queueNext` prefetches the chosen
 * exercise's route the moment it is known (`router.prefetch`) and re-populates `pendingHandoff`
 * with its already-fetched public content right then too, well before the learner ever clicks
 * "Next rep" -- so the remounted instance's very first render hydrates synchronously, with no
 * loading state and no `exercises_public` refetch.
 *
 * T2.2 round 5 re-check, New-1: `code` is the learner's typed answer for THIS exercise, carried
 * across the remount the same way the exercise/CLO/packages already are. Without it, the ~500ms
 * between `next()`'s local synchronous paint and the router's own remount landing was a window in
 * which anything typed into the (about to be destroyed) old instance's editor was silently
 * discarded -- the fresh instance's own `applyLoadedExercise` always reseeded from the exercise's
 * starter code, having no way to know a keystroke happened on an instance it never saw. `setCode`
 * (below) keeps this in sync on every keystroke while a handoff for the CURRENT exercise exists;
 * `applyLoadedExercise` seeds from it instead of the starter code when a handoff is consumed.
 */
let pendingHandoff: { id: string; exercise: ExercisePublic; clo: Clo; packages: string[]; code?: string } | null = null

/** The subset of a graded verdict a freshly (re)mounted instance needs to look right the instant
 *  it hydrates, before the durable background chain (which may have started on a now-gone
 *  instance) finishes reconciling it for real. */
type GradedSnapshot = {
  outcome: Outcome; results: TestResult[]; pointsEarned: number; pointsProvisional: boolean
  chain: number; closed: boolean; code: string; hintCount: number
}
/**
 * Fix round 4: "the pendingHandoff idea, completed" -- the same module-scope-survives-a-remount
 * pattern, generalized from "which exercise is this" to "is a submission for this exact
 * exercise in flight or freshly graded but not yet durably saved." Keyed by user+exercise
 * (`submissionKey`) since a submission belongs to exactly one learner's one exercise. `attemptId`
 * (== `Submission.attempt.id`, a UUID already minted per submit) is the record's own identity --
 * `isCurrent` compares against it rather than any per-instance `generation` ref, specifically so
 * a remount (which never touches this map) can never make an in-flight write look "stale" the
 * way the per-instance guards it replaces used to. Registered the moment `submit()` starts
 * (`operation`/`graded` still null -- the runtime hasn't graded anything yet) and filled in once
 * grading resolves; `ready` and `settle` let a (re)mounted instance either wait for the verdict
 * (mounted before grading finished) or adopt it immediately (mounted after) and then, either way,
 * learn when the durable save itself finishes or fails.
 *
 * Fix round 5, C2: `nextExercise`/`closed` are new -- `queueNext` records the exercise it chose
 * (or that the CLO closed) directly onto this record, and the settle handler restores it, so a
 * remount mid-chain no longer strands a passed rep with `nextExercise: null` and `canAdvance`
 * false forever (the CLO-closed case was already covered indirectly, since the settle handler
 * reads `closed` off the durably-saved mastery row regardless -- `closed` here is belt and braces).
 */
type PendingRecord = {
  attemptId: string
  operation: Submission | null
  graded: GradedSnapshot | null
  nextExercise: ExercisePublic | null
  closed: boolean
  /** Resolves once `operation`/`graded` are populated -- grading has a verdict. */
  ready: Promise<void>
  markReady: () => void
  /** Resolves once the durable background chain finishes, pass or fail; check `.error` after. */
  settle: Promise<void>
  markSettled: () => void
  error: string | null
}
const pendingSubmissions = new Map<string, PendingRecord>()
const submissionKey = (userId: string, exerciseId: string) => `${userId}:${exerciseId}`
/** False once a DIFFERENT submission (a distinct `attemptId`) has replaced this one for the same
 *  user+exercise -- never false merely because the component that started it unmounted. */
function isCurrent(key: string, attemptId: string): boolean {
  return pendingSubmissions.get(key)?.attemptId === attemptId
}

/**
 * Fix round 5 (review Mi1): the success path already deletes its own record the instant it
 * settles (`syncInBackground`); a FAILED one is kept on purpose so `retry()` can recover it from
 * any later mount, which means nothing ever evicted one before this. Each retained record holds
 * the submitted code, a full results array and a `LearnerState` clone -- bounded here to the
 * `MAX_RETAINED_FAILED_SUBMISSIONS` most recently failed keys, oldest evicted first, rather than
 * left to grow with the number of exercises a learner has ever failed to save.
 */
const MAX_RETAINED_FAILED_SUBMISSIONS = 5
const failedSubmissionOrder: string[] = []
function retainFailedSubmission(key: string): void {
  const already = failedSubmissionOrder.indexOf(key)
  if (already !== -1) failedSubmissionOrder.splice(already, 1)
  failedSubmissionOrder.push(key)
  while (failedSubmissionOrder.length > MAX_RETAINED_FAILED_SUBMISSIONS) pendingSubmissions.delete(failedSubmissionOrder.shift()!)
}
function forgetFailedSubmission(key: string): void {
  const index = failedSubmissionOrder.indexOf(key)
  if (index !== -1) failedSubmissionOrder.splice(index, 1)
}

function clearExerciseLoopModuleState(): void {
  pendingHandoff = null
  pendingSubmissions.clear()
  failedSubmissionOrder.length = 0
}
/**
 * Fix round 5 (review Mi1): registers with `src/lib/query/client.ts`'s cleanup registry so a
 * client-side user change (today only reachable in tests; `/auth/signout` is a full document
 * navigation that discards the whole heap on its own) can never resurrect a different learner's
 * in-flight or failed submission. Registering rather than that file importing this one directly
 * avoids a cycle -- this hook already imports `getQueryClient` from there. Module load only runs
 * once regardless of how many components call `useExerciseLoop`.
 */
onUserChange(clearExerciseLoopModuleState)

/**
 * Fix round 4: both module-scope stores above are deliberately real singletons -- module scope,
 * not component scope, is the entire point (surviving a remount). In production that lifetime is
 * the page's own. In a test file, the same module registry is shared by every `it()` in the run,
 * so a record an earlier test left pending (a durability failure, on purpose, in several fixtures
 * below) would otherwise leak into a later test's fresh mount of the same user+exercise id. Tests
 * only; nothing in `page.tsx` or this hook calls this.
 */
export function __resetExerciseLoopModuleStateForTests(): void {
  clearExerciseLoopModuleState()
}

type Status = 'loading' | 'ready' | 'running' | 'graded' | 'submitting' | 'failed' | 'passed' | 'error'
/** The durable pass/fail fact, known the instant local grading resolves. Never rolled back by a
 *  later network failure (brief step 3) -- `status` may keep moving (`graded` -> `submitting` on a
 *  retry -> `passed`/`failed` once the whole background chain settles), but `outcome` is set once,
 *  at grading time, and stays put regardless of what happens to the save. */
type Outcome = 'passed' | 'failed' | null
/** The neutral quality used for the optimistic XP figure before the Reviewer answers (spec 5.3/7.2). */
const NEUTRAL_QUALITY = 70
/** R5.1b: capped, matching the window every other reward/report consumer already uses. */
const HISTORY_CAP = 50
type History = { id: string; exercise_id: string; passed: boolean; hint_count: number; created_at: string }
type Submission = {
  // C1/I1 (wave 2 review, fix round): typed as the full `RewardAttempt` (not the narrower
  // `Attempt`) so `operation.attempt.durationMs` and `operation.attempt.difficulty` -- both
  // real and already known at grading time (`submit()` builds `rewardAttempt` with both) --
  // stay visible to the type system all the way through to `recordRewardsAfterSettle` below,
  // instead of being widened away the moment they are stored on this field.
  attempt: RewardAttempt; exercise: ExercisePublic; clo: Clo; inserted: boolean
  diagnosis?: DiagnoserReply; review?: ReviewerReply; state?: LearnerState
  masterySaved?: boolean; planned?: boolean; planner?: PlannerReply; queued?: boolean
  /** Captured once at grading time (fix round I3): a retry that re-enters `finishSubmission`
   *  after the state write already succeeded must still report the level/streak crossing off
   *  the ORIGINAL pre-save numbers, not off `operation.state`, which by then already IS "after". */
  beforePoints?: number; beforeStreak?: LearnerState['streak']
}
type HintReceipt = { count: number; calledAt: number | null; failureId: string | null; hints: CoachReply[] }
const hintKey = (userId: string, exerciseId: string) => `brogram:hints:${userId}:${exerciseId}`
function readHintReceipt(userId: string, exerciseId: string): HintReceipt {
  try {
    const saved = JSON.parse(sessionStorage.getItem(hintKey(userId, exerciseId)) ?? 'null')
    if (saved && Number.isInteger(saved.count) && saved.count >= 0 && saved.count <= LOCKDOWN.maxHintsPerExercise) {
      return { count: saved.count, calledAt: typeof saved.calledAt === 'number' && Number.isFinite(saved.calledAt) ? saved.calledAt : null, failureId: typeof saved.failureId === 'string' ? saved.failureId : null, hints: Array.isArray(saved.hints) ? saved.hints.filter((hint: CoachReply) => hint && typeof hint.hint === 'string' && Number.isInteger(hint.planStep)).slice(0, 5) : [] }
    }
  } catch { /* Storage may be disabled; the agent route still enforces the limit. */ }
  return { count: 0, calledAt: null, failureId: null, hints: [] }
}
function writeHintReceipt(userId: string, exerciseId: string, receipt: HintReceipt) {
  try { sessionStorage.setItem(hintKey(userId, exerciseId), JSON.stringify(receipt)) } catch { /* Keep the live quota when storage is unavailable. */ }
}
const messageOf = (error: unknown) => error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Something went wrong. Try again.'
const emptyMastery = (userId: string, cloId: string): Mastery => ({ userId, cloId, score: 0, chain: 0, patternsPassed: [], closed: false, lastAttemptAt: null })

/**
 * R5.1b: resolve an exercise id against whatever static course bundles are
 * already memoised (T0.3) before ever touching `exercises_public`. CLOs and
 * course metadata are always static (never runtime-generated, unlike an
 * exercise), so a bundle hit resolves the exercise, its CLO and the course's
 * Pyodide packages for zero network requests. A miss -- the runtime-generated
 * case, or a cold deep link whose course bundle was never loaded this session
 * -- returns null and the caller falls through to a single `exercises_public`
 * read; CLO/course still resolve from the static lookups either way, so that
 * fallback never touches `clos` or `courses`.
 */
function resolveFromBundle(id: string): { exercise: ExercisePublic; clo: Clo; packages: string[] } | null {
  for (const course of staticCourses()) {
    const exercise = exerciseFrom(course.code, id)
    if (!exercise) continue
    const outcome = staticClo(exercise.cloId)
    if (!outcome) continue
    return { exercise, clo: outcome, packages: course.packages ?? [] }
  }
  return null
}

function activityStreak(state: LearnerState, at: string): LearnerState['streak'] {
  const today = at.slice(0, 10)
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
  return { ...state.streak, lastExerciseDate: today, exerciseDays: state.streak.lastExerciseDate === today ? Math.max(1, state.streak.exerciseDays) : state.streak.lastExerciseDate === yesterday ? state.streak.exerciseDays + 1 : 1 }
}

/** Stateful orchestration only: runtimes, agent clients and learner math remain frozen. */
export function useExerciseLoop(exerciseId: string, motionPref?: MotionPreference) {
  const session = useSession(); const router = useRouter()
  const sessionRef = useRef(session)
  useEffect(() => { sessionRef.current = session }, [session])
  const clientRef = useRef<SupabaseClient | null>(null)
  const generation = useRef(0); const gate = useRef(false)
  const exerciseRef = useRef<ExercisePublic | null>(null); const cloRef = useRef<Clo | null>(null)
  const packages = useRef<string[]>([]); const history = useRef<History[]>([])
  const codeRef = useRef(''); const startedAt = useRef<number | null>(null)
  const failureAt = useRef<number | null>(null); const failedCode = useRef('')
  const editedAfterFailure = useRef(false)
  const failureId = useRef<string | null>(null); const hintedFailureId = useRef<string | null>(null)
  const lastCoachAt = useRef<number | null>(null); const lastHintCode = useRef('')
  const spentHints = useRef(0); const completed = useRef(false)
  const pending = useRef<Submission | null>(null)
  // V4 / A11Y-03 (wave 2 review): a bare `useReducedMotion()` call means 'system' -- it can never
  // see a learner who chose Reduced (or Full) in the app on an OS that reports no preference
  // either way. `motionPref` is the caller's own resolved `wellness.prefs.motion` (the exercise
  // page reads it the same way `ThemeQuickSwitch`/the dashboard already do); this hook's only
  // internal use of it gates the `next()` view transition below.
  const reducedMotion = useReducedMotion(motionPref)
  const [exercise, setExercise] = useState<ExercisePublic | null>(null)
  const [clo, setClo] = useState<Clo | null>(null)
  const [code, updateCode] = useState(''); const [status, setStatus] = useState<Status>('loading')
  const [results, setResults] = useState<TestResult[]>([])
  const [diagnosis, setDiagnosis] = useState<DiagnoserReply | null>(null)
  const [partialDiagnosis, setPartialDiagnosis] = useState<Partial<DiagnoserReply> | null>(null)
  const [hints, setHints] = useState<CoachReply[]>([]); const hintsRef = useRef<CoachReply[]>([])
  const [partialHint, setPartialHint] = useState<Partial<CoachReply> | null>(null)
  const [hintPending, setHintPending] = useState(false)
  const [review, setReview] = useState<ReviewerReply | null>(null)
  const [nextExercise, setNextExercise] = useState<ExercisePublic | null>(null)
  const [progress, setProgress] = useState<RuntimeProgress | null>(null)
  const [stdout, setStdout] = useState(''); const [stderr, setStderr] = useState('')
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false)
  const [hasPending, setHasPending] = useState(false)
  const [hintCount, setHintCount] = useState(0); const [clock, setClock] = useState(0)
  const [hintTiming, setHintTiming] = useState<{ failureAt: number | null; coachAt: number | null; edited: boolean; first: boolean }>({ failureAt: null, coachAt: null, edited: false, first: true })
  const [duringAttempt, setDuringAttempt] = useState(false)
  const [pointsEarned, setPointsEarned] = useState(0); const [closed, setClosed] = useState(false)
  const [reload, setReload] = useState(0)
  /** Brief step 1/3: the durable verdict, set once at grading time and never rolled back. */
  const [outcome, setOutcome] = useState<Outcome>(null)
  /** Brief step 2: the XP figure is provisional (neutral quality 70) until the Reviewer answers. */
  const [pointsProvisional, setPointsProvisional] = useState(false)
  /** The current CLO's chain, 0-3, for the instant chain-pip indicator. */
  const [chain, setChain] = useState(0)
  /** T2.5's `RewardAttempt`, difficulty attached, for whichever consumer evaluates achievements next. */
  const [lastRewardAttempt, setLastRewardAttempt] = useState<RewardAttempt | null>(null)
  /**
   * M4 (wave 2 review, fix round): true exactly when this render's exercise was just hydrated
   * from a `pendingHandoff` whose `code` field was set -- i.e. the learner typed into the
   * about-to-be-replaced instance during the ~500ms remount window (New-1), and the fresh
   * instance seeded from that typed code rather than the exercise's starter code. `page.tsx`
   * reads this to decide where the post-remount layout effect sends focus: back into the
   * editor (so the caret the learner was mid-keystroke on is not stranded on a `tabIndex={-1}`
   * heading) rather than the heading every OTHER exercise transition correctly focuses.
   */
  const [seededFromHandoffCode, setSeededFromHandoffCode] = useState(false)

  const fireCelebration = useCallback((kind: CelebrationKind, detail: CelebrationDetail | undefined, eventId: string) => {
    // `celebrate()`'s own `eventId` dedupes (T2.6 fix round): a retry re-entering the
    // background chain, or a StrictMode double-invoke, can never enqueue the same verdict twice.
    celebrate(kind, detail, eventId)
  }, [])

  useEffect(() => {
    try { sessionStorage.setItem('brogram:attempt-active', String(duringAttempt)) } catch { /* Wellness remains usable without storage. */ }
    return () => { try { sessionStorage.setItem('brogram:attempt-active', 'false') } catch { /* Storage is optional. */ } }
  }, [duringAttempt])

  /**
   * Fix round C1: the one place an exercise (bundled or freshly fetched, an initial mount or
   * `next()`'s in-place swap) becomes the displayed exercise. Fully synchronous and side-effect
   * free beyond its own refs/setters -- no network call gates it. The `attempts` read that used
   * to sit in front of it is now a background refresh kicked off from here: it only refines
   * `history.current` and the hint quota (already seeded below from the local receipt and
   * whatever `history.current` already holds), so it can never block the editor or the prompt.
   *
   * `handoffCode` (T2.2 round 5 re-check, New-1): when this call is consuming a module-level
   * `pendingHandoff`, its `code` field -- kept live by every `setCode` while that handoff still
   * matched the exercise on screen -- wins over the exercise's own starter code, so a keystroke
   * made in the remount window is not silently thrown away in favour of a blank/starter slate.
   */
  function applyLoadedExercise(item: ExercisePublic, cloRow: Clo, coursePackages: string[], token: number, handoffCode?: string) {
    gate.current = false; completed.current = false; pending.current = null
    failureAt.current = null; lastCoachAt.current = null; editedAfterFailure.current = false
    failureId.current = null; startedAt.current = null
    packages.current = coursePackages
    const userId = sessionRef.current.user?.id ?? ''
    const receipt = readHintReceipt(userId, item.id)
    const used = Math.min(LOCKDOWN.maxHintsPerExercise, Math.max(receipt.count, ...history.current.filter(row => row.exercise_id === item.id).map(row => row.hint_count ?? 0)))
    lastCoachAt.current = receipt.calledAt; hintsRef.current = receipt.hints
    hintedFailureId.current = receipt.failureId
    spentHints.current = used
    exerciseRef.current = item; cloRef.current = cloRow
    const initialCode = handoffCode ?? (usesAnswerForm(item) ? item.kind === 'spot-the-bug' ? '[]' : item.kind === 'trace' ? '{}' : '' : item.starterCode)
    codeRef.current = initialCode
    updateCode(initialCode)
    setExercise(item); setClo(cloRow); setStatus('ready')
    setResults([]); setDiagnosis(null); setPartialDiagnosis(null); setHints(receipt.hints); setPartialHint(null)
    setReview(null); setNextExercise(null); setProgress(null); setStdout(''); setStderr('')
    setDuringAttempt(false); setPointsEarned(0); setPointsProvisional(false); setChain(0)
    setClosed(false); setOutcome(null); setLastRewardAttempt(null); setHintPending(false)
    setHasPending(false); setError(null); setBusy(false); setHintCount(used)
    setHintTiming({ failureAt: null, coachAt: receipt.calledAt, edited: false, first: true })
    setClock(Date.now())
    // M4: `handoffCode !== undefined` means `setCode` wrote into this exact handoff before it
    // was consumed -- the one case this flag exists to catch. A `queueNext`/`next()`-populated
    // handoff with no typing in the gap, a bundle hit, or a cold fetch all leave it `undefined`.
    setSeededFromHandoffCode(handoffCode !== undefined)
    // Fix round 4: this exact user+exercise may already have a submission in flight or freshly
    // graded but not yet durably saved, in `pendingSubmissions` -- surviving a remount that
    // happened between `submit()` starting and its background chain finishing (the CPU-throttle
    // investigation's reproduced mechanism). This instance ADOPTS it instead of showing the blank
    // "ready" state the resets above just painted.
    const submissionRecord = pendingSubmissions.get(submissionKey(userId, item.id))
    if (submissionRecord) {
      pending.current = submissionRecord.operation
      setHasPending(true); setDuringAttempt(false)
      if (submissionRecord.graded) {
        const { graded } = submissionRecord
        codeRef.current = graded.code; updateCode(graded.code)
        setStatus('graded'); setOutcome(graded.outcome); setPointsEarned(graded.pointsEarned)
        setPointsProvisional(graded.pointsProvisional); setChain(graded.chain); setClosed(graded.closed)
        // Fix round 5, C2: restored here too, in case `queueNext` already chose one before this
        // mount happened -- the settle handler below is the guaranteed-final source, this is best
        // effort for the narrow window between the two.
        if (submissionRecord.nextExercise) setNextExercise(submissionRecord.nextExercise)
      } else {
        // Grading itself (the runtime call) is still running on whatever instance started it.
        setStatus('submitting')
      }
      // T2.2 round 5 re-check, New-2: `generation.current !== token` alone is the guard here now --
      // no separate `mounted` ref. A true unmount always runs the load effect's own cleanup, which
      // bumps `generation.current` past every token this instance ever handed out (see the
      // cleanup below), so it already catches "this instance is gone" with no extra latch; the
      // other paths that bump it (a `next()` on a surviving instance, a `retry()`-driven reload)
      // are cases where a stale `ready`/`settle` reconciliation should also be skipped. A `mounted`
      // ref was tried here and measured to add a real hazard for no real protection: under React's
      // dev Strict Mode double-invoke, its own reset-on-setup step is easy to omit (as fix round 4
      // originally did, live-reproducing the review's C2 symptom), and no test in this suite's
      // `renderHook`/jsdom environment can catch a regression of it either way (re-verified with a
      // `<StrictMode>`-wrapped copy of the mid-grade remount test with the reset removed -- it
      // still passed). Native promises have no `off()`; this generation check is the idiomatic
      // React substitute for detaching a `.then` continuation once its effect has torn down.
      void submissionRecord.ready.then(() => {
        if (generation.current !== token || !submissionRecord.graded) return
        const { graded } = submissionRecord
        codeRef.current = graded.code; updateCode(graded.code)
        setStatus('graded'); setOutcome(graded.outcome); setPointsEarned(graded.pointsEarned)
        setPointsProvisional(graded.pointsProvisional); setChain(graded.chain); setClosed(graded.closed)
        if (submissionRecord.nextExercise) setNextExercise(submissionRecord.nextExercise)
      })
      void submissionRecord.settle.then(() => {
        if (generation.current !== token) return
        if (submissionRecord.error) { setError(submissionRecord.error); return } // pending.current stays -- retry() can recover it
        pending.current = null; setHasPending(false)
        const finalOp = submissionRecord.operation
        if (finalOp?.diagnosis) setDiagnosis(finalOp.diagnosis)
        if (submissionRecord.graded?.outcome === 'passed' && finalOp?.review && finalOp.state) {
          setReview(finalOp.review)
          setPointsEarned(pointsForPass(item.difficulty, finalOp.attempt.hintCount, finalOp.review.quality))
          setPointsProvisional(false)
          const finalMastery = finalOp.state.mastery[item.cloId]
          // Fix round 5, C2: `nextExercise` restored from the record -- there is no durable row
          // for it the way mastery covers `closed`/`chain`. `record.closed` (set alongside
          // `record.nextExercise` in `queueNext`) is a belt-and-braces fallback if the mastery
          // read above somehow lacked a row at all, which should not happen once `finalOp.state`
          // exists but costs nothing to guard.
          if (finalMastery) { setChain(finalMastery.chain); setClosed(finalMastery.closed) }
          else setClosed(submissionRecord.closed)
          setNextExercise(submissionRecord.nextExercise)
          completed.current = true
          setStatus('passed')
        } else if (submissionRecord.graded?.outcome === 'failed') {
          setStatus('failed')
        }
      })
    }
    if (userId) {
      void (async () => {
        const client = clientRef.current ??= createClient()
        const result = await client.from('attempts').select('id,exercise_id,passed,hint_count,created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(HISTORY_CAP)
        if (generation.current !== token || result.error) return
        history.current = result.data ?? []
        const refreshed = Math.min(LOCKDOWN.maxHintsPerExercise, Math.max(spentHints.current, ...history.current.filter(row => row.exercise_id === item.id).map(row => row.hint_count ?? 0)))
        if (refreshed !== spentHints.current) { spentHints.current = refreshed; setHintCount(refreshed) }
      })()
    }
    // NEXT_PUBLIC_JUDGE_PROVIDER=browser gives Java a real runtime to warm up (CheerpJ, which
    // takes seconds, so warming it here matters). With no provider at all there is nothing to warm
    // and no agent to call; the exercise screen replaces Run/Submit with a not-available notice.
    if (!usesAnswerForm(item) && !(item.language === 'java' && judgeProviderAbsent())) {
      void getRuntime(item.kind === 'schema' ? 'sql' : item.language).warmup().catch(warmupError => {
        if (generation.current === token) setError(`Runtime preparation failed: ${messageOf(warmupError)}. Run or submit to retry.`)
      })
    }
  }

  useEffect(() => {
    // `next()` already resolved and rendered the target exercise synchronously
    // before updating the URL; this effect still fires (`exerciseId`, the URL
    // param, changed, and a real remount runs this on a brand-new instance
    // whose own state started fresh regardless). Consume the module-level
    // handoff (see the comment above `pendingHandoff`) if it matches this
    // exact exercise, and apply it directly and synchronously -- no async
    // gap for a fresh instance's own state to race against. A mismatched or
    // absent handoff (a genuine mount, a full reload, a deep link) falls
    // through to the normal reset-then-refetch path below.
    const handoff = pendingHandoff?.id === exerciseId ? pendingHandoff : null
    pendingHandoff = null
    const token = ++generation.current
    const active = () => generation.current === token
    const unsubscribe = subscribeRuntimeProgress(event => {
      const loaded = exerciseRef.current
      if (active() && loaded && event.language === (loaded.kind === 'schema' ? 'sql' : loaded.language)) setProgress(event)
    })
    if (handoff) {
      applyLoadedExercise(handoff.exercise, handoff.clo, handoff.packages, token, handoff.code)
    } else {
      void (async () => {
        await Promise.resolve()
        if (!active()) return
        setError(null)
        // R5.1b + fix round C1: resolve the bundle SYNCHRONOUSLY, before any await -- a hit
        // never shows a loading gap, even swapping straight from one exercise to another. A
        // miss (a runtime-generated exercise, or a cold deep link) leaves whatever is already
        // on screen in place rather than nulling `exercise` -- the previous prompt and editor
        // stay visible and usable while this resolves, instead of collapsing to a placeholder.
        const bundled = resolveFromBundle(exerciseId)
        if (bundled) { applyLoadedExercise(bundled.exercise, bundled.clo, bundled.packages, token); return }
        setStatus('loading')
        setResults([]); setDiagnosis(null); setPartialDiagnosis(null); setHints([]); setPartialHint(null)
        setReview(null); setNextExercise(null); setProgress(null); setStdout(''); setStderr('')
        setHintCount(0); setDuringAttempt(false); setPointsEarned(0); setClosed(false)
        setHasPending(false); setOutcome(null); setPointsProvisional(false); setChain(0)
        setLastRewardAttempt(null); setHintPending(false)
        setHintTiming({ failureAt: null, coachAt: null, edited: false, first: true }); setClock(Date.now())
        try {
          const client = clientRef.current ??= createClient()
          const userId = sessionRef.current.user?.id
          if (!userId) throw new Error(line('rep.signin'))
          const { data: row, error: readError } = await client.from('exercises_public').select('*').eq('id', exerciseId).eq('verified', true).maybeSingle()
          if (readError) throw readError
          if (!row) throw new Error(line('rep.unavailable'))
          const item = toExercisePublic(row)
          const staticOutcome = staticClo(item.cloId)
          if (!staticOutcome) throw new Error(line('skill.unavailable'))
          if (!active()) return
          applyLoadedExercise(item, staticOutcome, staticCourse(staticOutcome.course)?.packages ?? [], token)
        } catch (loadError) { if (active()) { setError(messageOf(loadError)); setStatus('error'); setExercise(null); setClo(null) } }
      })()
    }
    const timer = window.setInterval(() => { if (active()) setClock(Date.now()) }, 1000)
    return () => {
      generation.current = token + 1; unsubscribe(); window.clearInterval(timer)
      // Unconditional, not gated behind gate.current: getRuntime() adapters are
      // module-level singletons (one per language, src/lib/runtimes/index.ts),
      // so they outlive this effect's own instance -- including a router-driven
      // remount of this very component (confirmed live: navigating between
      // exercises via next()'s router.replace() does NOT preserve this hook's
      // instance despite page.tsx's own "same workspace instance" comment; a
      // fresh mount runs this cleanup for the OLD instance first). gate.current
      // only reflects whether THIS instance's own operate() call is mid-flight;
      // it says nothing about whether the adapter itself still has abandoned
      // timers or an unresolved pending run from a moment ago. abort() on both
      // adapters is already a safe no-op when nothing is pending, so calling it
      // unconditionally on every teardown costs nothing and closes the gap.
      const item = exerciseRef.current
      if (item && !usesAnswerForm(item)) getRuntime(item.kind === 'schema' ? 'sql' : item.language).abort()
    }
  }, [exerciseId, reload])

  const setCode = useCallback((value: string) => {
    if (completed.current || gate.current || pending.current || value === codeRef.current) return
    codeRef.current = value; updateCode(value)
    // T2.2 round 5 re-check, New-1: keep the module-level handoff's own code in sync with every
    // keystroke while it still refers to the exercise on screen -- this is what the remounted
    // instance seeds from (`applyLoadedExercise`'s `handoffCode` parameter) instead of silently
    // reseeding the starter code the instant the real navigation lands, ~500ms after `next()`'s
    // own local, synchronous paint.
    const handoff = pendingHandoff
    if (handoff && handoff.id === exerciseRef.current?.id) handoff.code = value
    if (failureAt.current !== null) { editedAfterFailure.current = true; setHintTiming(previous => ({ ...previous, edited: true })) }
    startedAt.current ??= Date.now(); setDuringAttempt(true); setClock(Date.now())
  }, [])

  const eligible = () => {
    if (completed.current || failureAt.current === null || spentHints.current >= LOCKDOWN.maxHintsPerExercise) return false
    if (failureId.current === hintedFailureId.current && lastCoachAt.current !== null) return Date.now() - lastCoachAt.current >= LOCKDOWN.hintCooldownS * 1000
    return editedAfterFailure.current || Date.now() - failureAt.current >= LOCKDOWN.hintCooldownS * 1000
  }
  const assertAllowed = () => {
    const currentSession = sessionRef.current
    if (!currentSession.user || !currentSession.learnerState) throw new Error(line('session.unavailable'))
    const profile = currentSession.profile
    if (profile?.account_status === 'banned' || profile?.account_status === 'restricted' && (!profile.restricted_until || Date.parse(profile.restricted_until) >= Date.now())) throw new Error(line('rep.paused'))
    return currentSession.learnerState
  }

  /**
   * Fix round 4: `token`/`generation.current` replaced with `isCurrent(key, attemptId)` in this
   * function and every function in the durability chain below it (`queueNext`, `finishSubmission`)
   * -- the OLD per-instance guard aborted this exact write the instant the calling instance's
   * effect cleanup ran, which happens on every unmount INCLUDING a remount, not only a genuine
   * "the learner moved on elsewhere" case. `isCurrent` is keyed on the module-level
   * `pendingSubmissions` record instead, which a remount never touches, so only a truly
   * different, newer submission for the same user+exercise can still make this abort.
   */
  async function saveState(delta: (base: LearnerState) => LearnerState, key: string, attemptId: string): Promise<LearnerState> {
    const client = clientRef.current!; const local = assertAllowed()
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: row, error: readError } = await client.from('learner_state').select('state,version').eq('user_id', local.userId).maybeSingle()
      if (!isCurrent(key, attemptId)) throw new Error(line('rep.changed.presave'))
      if (readError) throw readError
      const base = row?.state && row.state.mastery && row.state.profile && row.state.streak ? { ...row.state, version: row.version } as LearnerState : { ...local, version: row?.version ?? 0 }
      const changed = delta(base)
      if (changed === base) { sessionRef.current.setLearnerState(base); return base }
      const nextState = { ...changed, userId: local.userId, version: base.version + 1, updatedAt: new Date().toISOString() }
      const payload = { user_id: local.userId, state: nextState, version: nextState.version, updated_at: nextState.updatedAt }
      const write = row
        ? await client.from('learner_state').update(payload).eq('user_id', local.userId).eq('version', base.version).select('version').maybeSingle()
        : await client.from('learner_state').insert(payload).select('version').maybeSingle()
      if (write.error) {
        if ('code' in write.error && write.error.code === '23505') continue
        throw write.error
      }
      if (!write.data) continue
      if (!isCurrent(key, attemptId)) throw new Error(line('rep.changed.postsave'))
      sessionRef.current.setLearnerState(nextState)
      return nextState
    }
    throw new Error(line('rep.retry.elsewhere'))
  }

  async function queueNext(operation: Submission) {
    const key = submissionKey(operation.attempt.userId, operation.exercise.id); const attemptId = operation.attempt.id
    const client = clientRef.current!; const state = operation.state!
    const mastery = state.mastery[operation.exercise.cloId]
    if (mastery.closed) {
      // CLOs are always static curriculum data, never runtime-generated (R5.1b) -- no `clos` read.
      const clos = [...closFor(operation.clo.course)]
      if (!operation.planner) {
        const flatBanks = (await Promise.all(clos.map(item => fetchBank(client, { cloId: item.id })))).flat()
        if (!isCurrent(key, attemptId)) return
        try {
          operation.planner = (await callAgent({ agent: 'planner', trigger: 'plan-refresh', state, course: operation.clo.course, clos, candidates: flatBanks.slice(0, 30).map(({ id, cloId, pattern, difficulty, title }) => ({ id, cloId, pattern, difficulty, title })) })).reply
        } catch (plannerError) {
          // Fix round I4: "a course is never unusable because a model call failed" (R4.4,
          // src/app/(app)/courses/lib.ts:111-113) -- the same ruling applies to a CLO closing
          // mid-rep. Falling through here left `pending.current` set forever (finishSubmission
          // never reaches its own end), stranding a learner who just passed with Submit and
          // Next both dead. The provisional plan is a real, usable path either way.
          console.warn('Planner refresh failed after a CLO closed; using the provisional plan.', plannerError)
          const provisional = provisionalPlan({ code: operation.clo.course, clos, exercises: flatBanks, mastery: state.mastery })
          operation.planner = { path: provisional.path, nextExerciseIds: provisional.nextExerciseIds, focus: '' }
        }
      }
      if (!isCurrent(key, attemptId)) return
      if (!operation.planned) {
        const plan = operation.planner!
        try {
          // `focus` is not part of the frozen LearnerState contract; it rides along as an
          // extra jsonb key so the dashboard and report can show the Planner's latest line.
          operation.state = await saveState(base => ({ ...base, path: plan.path, nextExerciseIds: plan.nextExerciseIds, focus: plan.focus }) as typeof base, key, attemptId)
        } catch (saveError) {
          // Same ruling: a transient learner_state write failure here must not strand the
          // learner either. Keep them moving on the locally-merged plan; a later save (the next
          // pass, or a retry elsewhere) reconciles it for real.
          console.warn('Could not persist the refreshed plan after a CLO closed; keeping the learner unblocked.', saveError)
          operation.state = { ...operation.state!, path: plan.path, nextExerciseIds: plan.nextExerciseIds, focus: plan.focus } as LearnerState
        }
        operation.planned = true
      }
      setClosed(true); operation.queued = true
      // Fix round 5, C2 (belt and braces): the settle handler already restores `closed` from the
      // durably-saved mastery row regardless, but recording it here too costs nothing and matches
      // the same pattern the bank-pick branch below needs for `nextExercise`, which has no
      // equivalent durable source to fall back on.
      const closedRecord = pendingSubmissions.get(key)
      if (closedRecord?.operation === operation) closedRecord.closed = true
      return
    }
    const inChain = mastery.chain > 0 ? mastery.patternsPassed.slice(-mastery.chain) : []
    // Calling the frozen function with the existing last pattern does not advance it.
    const preferences = nextInChain(mastery, operation.exercise.pattern, operation.clo.patterns).preferPatterns
    const query: BankQuery = { cloId: operation.clo.id, difficulty: DEFAULT_DIFFICULTY, preferPatterns: preferences, excludePatterns: inChain, excludeExerciseIds: history.current.map(attempt => attempt.exercise_id) }
    const bank = await fetchBank(client, query)
    if (!isCurrent(key, attemptId)) return
    let chosen = pickFromBank(query, bank)
    if (!chosen) {
      try {
        const pattern = preferences[0]
        if (!pattern) throw new Error('No different pattern is available for this outcome.')
        const exampleIds = [...new Set(bank.map(item => item.id))].slice(0, 2)
        if (exampleIds.length < 2) throw new Error('Two distinct CLO examples are required before an exercise can be authored.')
        const parent = history.current.filter(attempt => attempt.passed && bank.some(item => item.id === attempt.exercise_id)).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0]?.exercise_id ?? operation.exercise.id
        const authored = await callAgent({ agent: 'author', trigger: 'bank-miss', state, clo: operation.clo, language: operation.exercise.language, kind: operation.exercise.kind, difficulty: DEFAULT_DIFFICULTY, pattern, exampleIds, parentExerciseId: parent })
        if (!isCurrent(key, attemptId)) return
        const generated = authored.reply.exercise as typeof authored.reply.exercise & { id?: unknown }
        if (typeof generated.id !== 'string' || !generated.id || generated.cloId !== operation.clo.id || generated.pattern !== pattern || inChain.includes(generated.pattern) || !generated.tests.length) throw new Error('The generated exercise did not match this chain.')
        const { referenceSolution, ...publicFields } = generated
        const publicExercise: ExercisePublic = { ...publicFields, id: generated.id, origin: 'generated', parentExerciseId: parent }
        const request = exerciseRunRequest(publicExercise, referenceSolution, true, packages.current)
        const verified = usesAnswerForm(publicExercise) ? gradeAnswer(publicExercise, referenceSolution) : await getRuntime(request.language).run(request)
        if (!verified.ok || verified.totalCount !== publicExercise.tests.length || verified.passedCount !== publicExercise.tests.length) throw new Error('The generated reference did not pass every test.')
        if (!isCurrent(key, attemptId)) return
        const response = await fetch('/api/exercises/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: publicExercise.id }) })
        const verification: unknown = await response.json()
        if (!response.ok || !verification || typeof verification !== 'object' || !('ok' in verification) || verification.ok !== true) throw new Error('The generated exercise could not be verified.')
        chosen = publicExercise
      } catch (authorError) {
        console.warn('Exercise generation failed; selecting the nearest bank exercise.', authorError)
        chosen = pickFromBank({ ...query, excludeExerciseIds: [] }, bank)
        if (!chosen) {
          const nearby = (await Promise.all(closFor(operation.clo.course).map(item => fetchBank(client, { cloId: item.id })))).flat()
          chosen = nearby.filter(item => item.id !== operation.exercise.id && item.pattern !== operation.exercise.pattern).sort((a, b) => Math.abs(a.difficulty - DEFAULT_DIFFICULTY) - Math.abs(b.difficulty - DEFAULT_DIFFICULTY))[0] ?? null
        }
        if (!chosen) throw new Error(line('rep.next.preparing'))
      }
    }
    if (!isCurrent(key, attemptId)) return
    setNextExercise(chosen); operation.queued = true
    // Fix round 5, C2: recorded on the module record so a remount mid-chain restores
    // `nextExercise` (and therefore `canAdvance`) instead of stranding a passed rep at "Pass
    // saved." forever -- there is no durable row to fall back on for this the way mastery's own
    // `closed` flag covers the CLO-close branch above.
    const record = pendingSubmissions.get(key)
    if (record?.operation === operation) record.nextExercise = chosen
    // Fix round 5: make the remount `next()` will cause invisible. Prefetches the chosen
    // exercise's route and re-populates `pendingHandoff` with its already-fetched content the
    // moment it is known -- well before the learner clicks "Next rep" -- so the remounted
    // instance's very first render hydrates synchronously with no loading state and no
    // `exercises_public` refetch (see the module comment above `pendingHandoff`).
    const chosenClo = staticClo(chosen.cloId) ?? operation.clo
    const chosenPackages = staticCourse(chosenClo.course)?.packages ?? packages.current
    pendingHandoff = { id: chosen.id, exercise: chosen, clo: chosenClo, packages: chosenPackages }
    router.prefetch(`/exercise/${encodeURIComponent(chosen.id)}`)
  }

  /**
   * X1 / X7 (wave 2 review): the shared writers from `src/lib/rewards/record.ts` (W2FIX-F2),
   * called from `syncInBackground`'s `finally` block once a submission's durability chain
   * settles -- pass or fail (`operation.state` exists either way once `finishSubmission`'s state
   * write lands; a fail scores through `applyFail`, not only a pass), since an achievement or a
   * goal day can legitimately already be earned by the time a fail lands (a streak milestone hit
   * earlier today, a goal met by two walkthroughs and this exercise being the third action of the
   * day regardless of its own verdict). Both writers are self-gating and pure-checked before any
   * write (`shouldRecordGoalDay`, `newlyUnlocked`), so calling this after every settle costs
   * nothing extra on the common "nothing new to record" case.
   *
   * Reads `lessonProgress` and the wellness row (`prefs`, `drill_results`) straight from the
   * query cache -- already seeded by `(app)/layout.tsx`'s `QuerySeed` before this page ever
   * mounts, so this is zero extra network requests, not a fresh read the way the old local
   * `recordGoalAndStreak` this replaces used to do for `prefs` alone. Critically, this is also
   * the X7 fix itself: the old version hardcoded `lessonProgress`/`drillResults` to `[]` ("this
   * hook only ever sees exercise attempts"), which meant a walkthrough-only or de-rot-only day
   * could reach the dashboard's own "goal met" ring while this producer's `winsToday` never
   * agreed and `goal.done` never fired. Real cached data closes that gap for free.
   *
   * Fix round (C1/I1): `attempts` used to be rebuilt from `history.current` -- the slim
   * `id,exercise_id,passed,hint_count,created_at` projection this hook reads for the hint
   * quota and bank exclusions -- with `durationMs` hard-coded to `0` and `difficulty` absent
   * entirely. That made `under-a-minute` (`durationMs < 60_000`, and 0 is always < 60_000)
   * permanently true on ANY hint-free pass however long it actually took, and made
   * `no-wheels` structurally unreachable from this call site since it requires
   * `difficulty >= 3` and nothing here ever had a difficulty to give it. `operation.attempt`
   * is already a full `RewardAttempt` with the real `durationMs` and `difficulty` (attached at
   * grading time in `submit()`, for exactly this purpose) -- taking it directly, and reading
   * the rest of the window from the query cache (`qk.attempts`, the same recipe the derot call
   * sites already use), fixes both at once with the freshest possible data for the
   * just-graded attempt, which the cache's own invalidation (fired two lines above, in
   * `syncInBackground`'s `finally`) has not necessarily resolved by the time this runs.
   *
   * Degrades silently on any failure -- a missed goal day or achievement is a missed
   * celebration, never a broken pass -- and is never awaited by the caller (`syncInBackground`'s
   * `finally` calls this with `void`).
   */
  async function recordRewardsAfterSettle(client: SupabaseClient, userId: string, operation: Submission) {
    try {
      const state = operation.state
      if (!state) return
      const cache = getQueryClient()
      const wellnessRow = cache.getQueryData<WellnessRow>(qk.wellness(userId))
      const prefs = resolveWellnessPrefs(wellnessRow?.prefs)
      const drillResults = wellnessRow?.drill_results ?? []
      const lessonProgress = cache.getQueryData<LessonProgress[]>(qk.lessonProgress(userId)) ?? []
      const heldAchievementIds = (cache.getQueryData<UserAchievement[]>(qk.achievements(userId)) ?? []).map(row => row.achievementId)
      const cachedAttempts = cache.getQueryData<Attempt[]>(qk.attempts(userId)) ?? []
      const attempts: RewardAttempt[] = [operation.attempt, ...cachedAttempts.filter(row => row.id !== operation.attempt.id)]
      const ctx = buildRewardContext({ state, attempts, activityDays: [], lessonProgress, drillResults, prefs, courseLessonCounts: {}, now: new Date(operation.attempt.createdAt) })
      void recordGoalDay(client, userId, ctx)
      void recordAchievements(client, userId, ctx, heldAchievementIds)
    } catch (rewardsError) {
      console.warn('Could not evaluate goal/achievement rewards after this save; the pass itself is unaffected.', rewardsError)
    }
  }

  async function finishSubmission(operation: Submission) {
    const key = submissionKey(operation.attempt.userId, operation.exercise.id); const attemptId = operation.attempt.id
    const client = clientRef.current!; const attempt = operation.attempt
    if (!operation.inserted) {
      const { error: insertError } = await client.from('attempts').upsert({ id: attempt.id, user_id: attempt.userId, exercise_id: attempt.exerciseId, code: attempt.code, results: attempt.results, passed: attempt.passed, duration_ms: attempt.durationMs, hint_count: attempt.hintCount, created_at: attempt.createdAt }, { onConflict: 'id', ignoreDuplicates: true })
      if (insertError) throw insertError
      operation.inserted = true
      if (!isCurrent(key, attemptId)) return
      history.current.unshift({ id: attempt.id, exercise_id: attempt.exerciseId, passed: attempt.passed, hint_count: attempt.hintCount, created_at: attempt.createdAt })
    }
    if (!isCurrent(key, attemptId)) return
    const state = assertAllowed()
    // Fix round I3: captured once at grading time (`submit()`), not re-read here -- a retry
    // that re-enters this function after the state write already succeeded would otherwise
    // compare `operation.state.points` against itself and silently drop a level-up card that
    // legitimately fired on the very first attempt.
    const beforePoints = operation.beforePoints ?? state.points
    const beforeStreak = operation.beforeStreak ?? state.streak
    const exerciseRefForAgent = { id: operation.exercise.id, cloId: operation.exercise.cloId, pattern: operation.exercise.pattern, prompt: operation.exercise.prompt, language: operation.exercise.language }
    if (attempt.passed) {
      if (!operation.review) operation.review = (await callAgent({ agent: 'reviewer', trigger: 'attempt-passed', state, exercise: exerciseRefForAgent, code: attempt.code, hintCount: attempt.hintCount, durationMs: attempt.durationMs })).reply
      if (!isCurrent(key, attemptId)) return
      setReview(operation.review)
      // Step 2: the tween IS the reconciliation -- fires the instant the real quality lands,
      // not after the slower mastery-save/queueNext chain below.
      setPointsEarned(pointsForPass(operation.exercise.difficulty, attempt.hintCount, operation.review.quality))
      setPointsProvisional(false)
    } else {
      if (!operation.diagnosis) {
        operation.diagnosis = (await streamAgent({ agent: 'diagnoser', trigger: 'attempt-failed', state, exercise: { ...exerciseRefForAgent, kind: operation.exercise.kind }, code: attempt.code, results: attempt.results }, partial => { if (isCurrent(key, attemptId)) setPartialDiagnosis(partial) })).reply
      }
      if (!isCurrent(key, attemptId)) return
      setPartialDiagnosis(null); setDiagnosis(operation.diagnosis)
    }
    if (!operation.state) {
      operation.state = await saveState(base => {
        const previous = base.mastery[operation.exercise.cloId] ?? emptyMastery(base.userId, operation.exercise.cloId)
        // A retried response after a lost network acknowledgement must not award twice.
        if (previous.lastAttemptAt === attempt.createdAt) return base
        if (previous.lastAttemptAt && Date.parse(previous.lastAttemptAt) > Date.parse(attempt.createdAt)) throw new Error(line('rep.stale.attempt'))
        const scored = attempt.passed ? applyPass(previous, operation.exercise.difficulty, operation.exercise.pattern, operation.review!.quality, attempt.hintCount) : { mastery: applyFail(previous, operation.exercise.difficulty), points: 0 }
        const mastery = { ...scored.mastery, lastAttemptAt: attempt.createdAt }
        const mistakes = operation.diagnosis ? [{ exerciseId: attempt.exerciseId, cloId: operation.exercise.cloId, pattern: operation.exercise.pattern, label: operation.diagnosis.mistakeLabel, at: attempt.createdAt }, ...base.recentMistakes].slice(0, 10) : base.recentMistakes
        // W2-SCHEMA-I3 (wave 2 review), binding ruling: a streak day is a PASS. Migration 0008's
        // `my_activity_days()` filters `where ... and passed`, so a fail bumping this client-side
        // streak (the pre-existing behaviour) diverges from what the server counts the moment 0008
        // is applied -- the header flips between two numbers on a single reload for a learner who
        // fails before passing on a given day. `base.streak` on a fail is therefore left untouched.
        return { ...base, currentCourse: operation.clo.course, mastery: { ...base.mastery, [operation.exercise.cloId]: mastery }, points: base.points + scored.points, recentMistakes: mistakes, streak: attempt.passed ? activityStreak(base, attempt.createdAt) : base.streak }
      }, key, attemptId)
    }
    if (!isCurrent(key, attemptId)) return
    let mastery = operation.state.mastery[operation.exercise.cloId]
    if (!operation.masterySaved) {
      // A state write may have succeeded before a retry. Repair from the newest
      // document and condition the row update so an older tab cannot roll it back.
      const latest = await client.from('learner_state').select('state,version').eq('user_id', attempt.userId).maybeSingle()
      if (latest.error) throw latest.error
      if (!isCurrent(key, attemptId)) return
      if (latest.data?.state?.mastery?.[operation.exercise.cloId] && latest.data.version >= operation.state.version) {
        operation.state = { ...latest.data.state, version: latest.data.version } as LearnerState
        mastery = operation.state.mastery[operation.exercise.cloId]
      }
      const row = { user_id: mastery.userId, clo_id: mastery.cloId, score: mastery.score, chain: mastery.chain, patterns_passed: mastery.patternsPassed, closed: mastery.closed, last_attempt_at: mastery.lastAttemptAt }
      const inserted = await client.from('mastery').upsert(row, { onConflict: 'user_id,clo_id', ignoreDuplicates: true })
      if (inserted.error) throw inserted.error
      if (!isCurrent(key, attemptId)) return
      const updated = await client.from('mastery').update(row).eq('user_id', mastery.userId).eq('clo_id', mastery.cloId).or(`last_attempt_at.is.null,last_attempt_at.lte."${mastery.lastAttemptAt ?? attempt.createdAt}"`).select('clo_id').maybeSingle()
      if (updated.error) throw updated.error
      if (!updated.data) throw new Error(line('rep.stale.mastery'))
      operation.masterySaved = true
    }
    if (!isCurrent(key, attemptId)) return
    if (attempt.passed) {
      completed.current = true
      setPointsEarned(pointsForPass(operation.exercise.difficulty, attempt.hintCount, operation.review!.quality))
      setClosed(mastery.closed); setChain(mastery.chain)
      // Level up is a rare-event card (spec 7.6); wait for the real, saved points total rather
      // than the optimistic one, since a Reviewer swing near a level boundary could cross it
      // differently than the neutral-quality preview did.
      const levelUp = levelUpDetail(beforePoints, operation.state.points)
      if (levelUp) fireCelebration('level-up', levelUp, `${attempt.id}:level`)
      // Fix round I5: streak ignite/milestone are pure, derived from the state this pass just
      // saved -- no extra read. Milestone takes priority over the routine ignite card when a
      // pass happens to do both (spec 7.6's own celebration table compounds this way elsewhere,
      // e.g. "clo.close layered with level.up"; the queue, T2.6, shows one at a time either way).
      const afterStreak = operation.state.streak
      const milestone = crossedMilestone(beforeStreak.exerciseDays, afterStreak.exerciseDays)
      if (milestone !== null) fireCelebration('streak-milestone', { n: milestone }, `${attempt.id}:streak-milestone`)
      else if (beforeStreak.lastExerciseDate !== afterStreak.lastExerciseDate) fireCelebration('streak-ignite', { n: afterStreak.exerciseDays }, `${attempt.id}:streak-ignite`)
      // Goal-day and achievement evaluation moved to `syncInBackground`'s `finally` block
      // (`recordRewardsAfterSettle`, X1/X7) -- best-effort, fire-and-forget either way, but now
      // run once per settle regardless of pass/fail rather than only from this pass branch.
      if (!operation.queued) await queueNext(operation)
      if (!isCurrent(key, attemptId)) return
      setStatus('passed')
    } else {
      failureAt.current = Date.parse(attempt.createdAt); failedCode.current = attempt.code
      failureId.current = attempt.id
      editedAfterFailure.current = false
      setHintTiming({ failureAt: failureAt.current, coachAt: lastCoachAt.current, edited: false, first: hintedFailureId.current !== attempt.id })
      if (hintedFailureId.current !== attempt.id) lastHintCode.current = attempt.code
      setClock(Date.now()); setStatus('failed')
    }
    pending.current = null
    setHasPending(false)
  }

  async function operate(action: () => Promise<void>, kind: Status) {
    if (gate.current) return
    const token = generation.current
    gate.current = true; setBusy(true); setError(null); setStatus(kind)
    try { assertAllowed(); await action() }
    catch (operationError) { if (generation.current === token) { setError(messageOf(operationError)); setPartialDiagnosis(null); setPartialHint(null); setStatus('error') } }
    finally { if (generation.current === token) { gate.current = false; setBusy(false) } }
  }

  async function run() {
    const item = exerciseRef.current
    if (!item || completed.current || pending.current) return
    const token = generation.current
    await operate(async () => {
      if (usesAnswerForm(item)) { setStatus(failureAt.current === null ? 'ready' : 'failed'); return }
      const request = exerciseRunRequest(item, codeRef.current, false, packages.current)
      const runResult = await getRuntime(request.language).run(request)
      if (generation.current !== token) return
      setStdout(runResult.stdout ?? ''); setStderr(runResult.stderr ?? ''); setStatus(failureAt.current === null ? 'ready' : 'failed')
    }, 'running')
  }

  /**
   * Step 3: once the verdict is graded, a failure in the background sync must never roll it
   * back. Caught here rather than left to `operate()`'s generic catch, so `status`/`outcome`
   * stay put (a "didn't save, retrying" banner via `error`, not a hidden verdict) -- `retry()`
   * routes back through the same wrapper for the same guarantee on a second attempt.
   */
  async function syncInBackground(operation: Submission) {
    // Fix round 4: keyed off the module-level record, not the calling instance's `generation` --
    // this whole chain must keep running (and land its writes) even if the instance that started
    // it unmounts partway through, so its own liveness can no longer be what decides whether the
    // record gets marked settled. Setting state (`setError` below) on an instance that has since
    // unmounted is a silent no-op in React 18+; no guard is needed for that half any more either.
    const key = submissionKey(operation.attempt.userId, operation.exercise.id)
    try {
      await finishSubmission(operation)
      const record = pendingSubmissions.get(key)
      if (record?.operation === operation) { pendingSubmissions.delete(key); forgetFailedSubmission(key); record.markSettled() }
    }
    catch (syncError) {
      setError(messageOf(syncError)); setPartialDiagnosis(null); setPartialHint(null)
      // Kept in the map (not deleted) on failure: `pending.current`, hydrated from this same
      // record on any instance that mounts next, must still let `retry()` recover it. Fix round
      // 5 (review Mi1): `retainFailedSubmission` evicts the oldest kept failure once more than
      // `MAX_RETAINED_FAILED_SUBMISSIONS` are being held, so this can never grow unbounded.
      const record = pendingSubmissions.get(key)
      if (record?.operation === operation) { record.error = messageOf(syncError); record.markSettled(); retainFailedSubmission(key) }
    }
    finally {
      // A graded submission settling (pass, fail, or a background failure the retry banner
      // covers) is exactly the moment the dashboard's streak, goal ring, points and trophy
      // shelf go stale: `attempts` and `activityDays` change on every attempt -- the latter is
      // invalidated regardless of `attempt.passed` (W2-SCHEMA-I3's binding ruling only changed
      // what the client's OWN `state.streak` counts; the server-side `my_activity_days()` a fail
      // does not touch stays worth a cheap refetch here since over-invalidating a read is
      // harmless) -- `achievements` and `learner_state` on a pass. `saveState` predates T0.4's
      // `useOptimistic` and keeps its own version-guarded retry loop rather than being rebuilt on
      // it this task, so unlike a `useOptimistic` mutation there is no automatic self-invalidation
      // on the `learner-state` key -- invalidated explicitly here alongside the other three so a
      // stale reload is never required.
      const userId = sessionRef.current.user?.id
      if (userId) {
        const client = getQueryClient()
        void client.invalidateQueries({ queryKey: qk.attempts(userId) })
        void client.invalidateQueries({ queryKey: qk.activityDays(userId) })
        void client.invalidateQueries({ queryKey: qk.achievements(userId) })
        void client.invalidateQueries({ queryKey: qk.learnerState(userId) })
        // X1 / X7 (wave 2 review): evaluated off whatever state this settle actually reached --
        // `operation.state` exists once `finishSubmission`'s state write lands, pass or fail
        // (`applyFail` scores a fail too); a background failure before that point never sets it,
        // and there is nothing yet to evaluate a reward context against.
        if (operation.state) void recordRewardsAfterSettle(clientRef.current!, userId, operation)
      }
    }
  }

  async function submit() {
    const item = exerciseRef.current; const cloRow = cloRef.current
    if (!item || !cloRow || completed.current || pending.current) return
    // Fix round 4: `pending.current` alone does not yet know about a submission that is
    // registered in `pendingSubmissions` but still ungraded (the runtime call itself hasn't
    // resolved) -- a freshly hydrated instance's own `pending.current` stays null until grading
    // does. Without this, a remount landing exactly mid-run, followed by an immediate resubmit
    // click, could start a second submission for the same exercise before the first one even has
    // a verdict.
    const userIdForGuard = sessionRef.current.user?.id
    if (userIdForGuard) {
      const existing = pendingSubmissions.get(submissionKey(userIdForGuard, item.id))
      if (existing && !existing.graded) return
    }
    await operate(async () => {
      // Mi1 (fix round): clear the previous attempt's verdict the instant a new one starts,
      // not once grading finishes -- a slow CheerpJ/Pyodide run must never leave "Needs work"
      // (or a stale results table) on screen through the whole wait, and it must not survive
      // an `operate()` error either (this runs before anything that could throw pre-grading).
      setOutcome(null); setResults([])
      const state = assertAllowed(); const submittedCode = codeRef.current; const submittedAt = Date.now()
      const durationMs = Math.max(0, submittedAt - (startedAt.current ?? submittedAt))
      if (!item.tests.length) throw new Error(line('rep.notests'))
      if (submittedCode.length > 20_000) throw new Error('Keep your solution under 20,000 characters before submitting.')
      // Fix round 4: minted and registered in `pendingSubmissions` BEFORE the runtime call runs,
      // not after it resolves -- a remount while a slow runtime is still grading (a throttled
      // CPU running Pyodide/CheerpJ, in production; a forced remount in a test) used to hit the
      // very next `generation`-gated line and silently drop the whole submission before a
      // verdict even existed to protect. `record.operation`/`graded` fill in a few lines down,
      // once grading resolves; `markReady()` lets a (re)mounted instance move off its own
      // "still submitting" placeholder (`applyLoadedExercise`'s hydration) the moment that happens.
      const attemptId = crypto.randomUUID()
      const key = submissionKey(state.userId, item.id)
      let markReady!: () => void; let markSettled!: () => void
      const record: PendingRecord = {
        attemptId, operation: null, graded: null, nextExercise: null, closed: false,
        ready: new Promise(resolve => { markReady = resolve }), markReady,
        settle: new Promise(resolve => { markSettled = resolve }), markSettled,
        error: null,
      }
      pendingSubmissions.set(key, record)
      const request = exerciseRunRequest(item, submittedCode, true, packages.current)
      const result: RunResult = usesAnswerForm(item) ? gradeAnswer(item, submittedCode) : await getRuntime(request.language).run(request)
      if (!isCurrent(key, attemptId)) return
      setResults(result.results); setStdout(''); setStderr(''); setDuringAttempt(false); startedAt.current = null
      const previousTime = history.current[0]?.created_at ? Date.parse(history.current[0].created_at) : 0
      const at = new Date(Math.max(Date.now(), Number.isFinite(previousTime) ? previousTime + 1 : 0)).toISOString()
      const passedNow = result.ok && result.totalCount === item.tests.length && result.passedCount === item.tests.length
      // Difficulty attached (T2.5 Ruling 1): this loop already has the exercise's Difficulty in
      // memory at pass time, so the attempt it hands downstream is `RewardAttempt`-shaped from
      // the moment it exists, even though the `attempts` table itself carries no such column.
      const rewardAttempt: RewardAttempt = { id: attemptId, userId: state.userId, exerciseId: item.id, code: submittedCode, results: result.results, passed: passedNow, hintCount: spentHints.current, durationMs, createdAt: at, difficulty: item.difficulty }
      // Fix round I3: `beforePoints`/`beforeStreak` captured once, right here, so a retried
      // background sync always reports the level/streak crossing off these original numbers.
      const operation: Submission = { exercise: item, clo: cloRow, inserted: false, attempt: rewardAttempt, beforePoints: state.points, beforeStreak: state.streak }
      pending.current = operation; setHasPending(true); setDiagnosis(null); setPartialDiagnosis(null)

      // Steps 1 & 3: the browser knows pass or fail the instant grading resolves, before any
      // network call -- that is where the verdict, the optimistic XP, the chain pip and the
      // celebration all fire. `finishSubmission` still runs, but only in the background below.
      setStatus('graded'); setOutcome(passedNow ? 'passed' : 'failed'); setLastRewardAttempt(rewardAttempt)
      let snapshot: GradedSnapshot
      if (passedNow) {
        const previousMastery = state.mastery[item.cloId] ?? emptyMastery(state.userId, item.cloId)
        const graded = applyPass(previousMastery, item.difficulty, item.pattern, NEUTRAL_QUALITY, spentHints.current)
        setPointsEarned(graded.points); setPointsProvisional(true); setChain(graded.mastery.chain)
        const chainIncreased = graded.mastery.chain > previousMastery.chain
        const justClosed = graded.mastery.closed && !previousMastery.closed
        if (justClosed) setClosed(true)
        // The account's very first-ever pass gets the permanent full-screen moment (spec 7.6);
        // every other pass is routine (confetti there is rate-limited to the session's first).
        // `state.points` predates this save, so 0 here means no prior pass has ever landed --
        // robust across a capped attempts window in a way scanning `history.current` is not.
        fireCelebration((state.points ?? 0) === 0 ? 'first-win' : 'pass', undefined, attemptId)
        if (justClosed) fireCelebration('clo-close', { skill: cloRow.outcome }, `${attemptId}:close`)
        else if (chainIncreased) fireCelebration('chain', { n: graded.mastery.chain }, `${attemptId}:chain`)
        play('pass')
        snapshot = { outcome: 'passed', results: result.results, pointsEarned: graded.points, pointsProvisional: true, chain: graded.mastery.chain, closed: justClosed, code: submittedCode, hintCount: spentHints.current }
      } else {
        setChain(0)
        play('fail')
        snapshot = { outcome: 'failed', results: result.results, pointsEarned: 0, pointsProvisional: false, chain: 0, closed: false, code: submittedCode, hintCount: spentHints.current }
      }
      record.operation = operation; record.graded = snapshot; markReady()

      await syncInBackground(operation)
    }, 'submitting')
  }

  async function requestHint() {
    const item = exerciseRef.current
    if (!item || gate.current || pending.current || !diagnosis || !eligible()) return
    const token = generation.current
    gate.current = true; setBusy(true); setError(null)
    const currentCode = codeRef.current
    const previousHintCount = spentHints.current
    const previousCoachAt = lastCoachAt.current
    const previousHintedFailureId = hintedFailureId.current
    const previousHintTiming = hintTiming
    let receivedPartial = false
    let userId: string | null = null
    try {
      const state = assertAllowed()
      userId = state.userId
      // Spend and persist before awaiting: a failed request still consumed a call.
      lastCoachAt.current = Date.now(); spentHints.current++; setHintCount(spentHints.current); setClock(Date.now())
      hintedFailureId.current = failureId.current
      setHintTiming(previous => ({ ...previous, coachAt: lastCoachAt.current, first: false }))
      writeHintReceipt(state.userId, item.id, { count: spentHints.current, calledAt: lastCoachAt.current, failureId: hintedFailureId.current, hints: hintsRef.current })
      // Step 5: the hint card's skeleton appears on click, in the same frame as the pip decrement above.
      setHintPending(true)
      const reply = await streamAgent({ agent: 'coach', trigger: 'hint-requested', state, exercise: { id: item.id, cloId: item.cloId, pattern: item.pattern, prompt: item.prompt, language: item.language }, diffSinceLastHint: item.kind === 'code' ? codeDiff(lastHintCode.current, currentCode) : '', currentCode, fixPlan: diagnosis.fixPlan, hintsSoFar: hintsRef.current.map(previous => previous.hint) }, partial => { receivedPartial = true; if (generation.current === token) { setPartialHint(partial); setHintPending(false) } })
      if (generation.current !== token) return
      hintsRef.current = [...hintsRef.current, reply.reply]; setHints(hintsRef.current)
      writeHintReceipt(state.userId, item.id, { count: spentHints.current, calledAt: lastCoachAt.current, failureId: hintedFailureId.current, hints: hintsRef.current })
      lastHintCode.current = currentCode
    } catch (hintError) {
      if (generation.current === token) {
        setError(messageOf(hintError))
        // A transport failure that never streamed a partial frame did not reach the
        // agent in any observable way; refund the hint rather than stranding the student.
        if (!receivedPartial) {
          spentHints.current = previousHintCount; setHintCount(previousHintCount)
          lastCoachAt.current = previousCoachAt
          hintedFailureId.current = previousHintedFailureId
          setHintTiming(previousHintTiming)
          if (userId) writeHintReceipt(userId, item.id, { count: previousHintCount, calledAt: previousCoachAt, failureId: previousHintedFailureId, hints: hintsRef.current })
        }
      }
    }
    finally { if (generation.current === token) { setPartialHint(null); setHintPending(false); setBusy(false); gate.current = false } }
  }

  async function retry() {
    if (gate.current) return
    const operation = pending.current
    if (operation) { await operate(() => syncInBackground(operation), 'submitting') }
    else if (!exerciseRef.current) setReload(value => value + 1)
    else { setError(null); setStatus(completed.current ? 'passed' : failureAt.current === null ? 'ready' : 'failed') }
  }

  /**
   * How this is actually built, as of T2.2 round 5 (not the round 4 mechanism -- see the T2.2
   * round 5 re-check, New-3, which flagged the prior version of this comment as stale):
   *
   * 1. `nextExercise` is already a complete `ExercisePublic` (fetched by `queueNext`'s bank query
   *    or Author generation), so `commit()` calls `applyLoadedExercise` directly and
   *    synchronously -- no load-effect reset-then-refetch cycle for the exercise painted here.
   * 2. The URL update is a real `router.replace(url)`, wrapped in React's `startTransition`, not
   *    the raw History API a since-reverted round used. A navigation to a new dynamic-segment
   *    (`[id]`) value genuinely remounts this hook and everything under it in the live App
   *    Router (confirmed with a DOM-identity probe) -- there is no supported way to avoid that
   *    remount short of bypassing the router entirely, which round 4 tried and which broke
   *    `useParams()`, integrity logging and Back navigation instead (see the module's own C1/I1
   *    history). `startTransition` marks the resulting remount as low priority, so React keeps
   *    showing this instance's already-updated (optimistic) UI instead of yanking to
   *    `loading.tsx` while the navigation resolves -- the remount is real, but invisible.
   * 3. Invisible because `pendingHandoff` (populated by `queueNext` the moment the exercise was
   *    chosen, and refreshed again just below as cheap insurance against staleness) is what the
   *    remounted instance's very first render hydrates from, synchronously -- no loading state,
   *    no `exercises_public` refetch, and (T2.2 round 5 re-check, New-1) the learner's own typed
   *    code if `setCode` wrote any into it since. `pendingSubmissions` is the parallel
   *    remount-proofing for the durability chain itself; both exist independent of *why* a
   *    remount might happen, as insurance against any cause this fix does not anticipate too
   *    (Fast Refresh in dev, a future upstream change).
   *
   * Fix round I1: the browser's native View Transition needs the DOM change to happen
   * *synchronously inside* its callback, or it captures old-to-old and crossfades nothing.
   * `flushSync` forces React to commit `applyLoadedExercise`'s state updates before the callback
   * returns, which is the documented way to pair React with this API absent React's own
   * `<ViewTransition>` component (not exported by this tree's pinned React 19.2.8 -- see report).
   * The prompt panel carries the transition name (`page.tsx`) so only it crossfades; the editor
   * and the warm runtime never remount either way -- until the real router-driven remount above,
   * which they do survive, just invisibly.
   */
  async function next() {
    if (!completed.current || gate.current || pending.current) return
    if (closed) { router.push('/dashboard'); return }
    const target = nextExercise
    if (!target) return
    // Fix round 2, N1: `queueNext`'s last-resort fallback is explicitly cross-CLO (it searches
    // every CLO in the course once the current one's bank and the Author both come up empty),
    // so `target` can legitimately belong to a different CLO than the one just passed. Reusing
    // `cloRef.current` unchanged ran the new rep under the wrong CLO -- wrong prompt outcome
    // text, the next `submit()` querying the wrong bank, a `clo-close` naming the wrong skill.
    // Every other entry point derives the CLO from the exercise itself; this one now does too.
    const cloRow = staticClo(target.cloId) ?? cloRef.current
    if (!cloRow) return
    const coursePackages = staticCourse(cloRow.course)?.packages ?? packages.current
    const url = `/exercise/${encodeURIComponent(target.id)}`
    // Fix round 5: `pendingHandoff` was very likely already populated by `queueNext` the moment
    // this exercise was chosen (see its own comment on the prefetch/hydration this enables) --
    // refreshed here too, right before the router call, as cheap insurance against staleness.
    const commit = () => {
      const token = ++generation.current
      pendingHandoff = { id: target.id, exercise: target, clo: cloRow, packages: coursePackages }
      applyLoadedExercise(target, cloRow, coursePackages, token)
    }
    if (!reducedMotion && typeof document !== 'undefined' && 'startViewTransition' in document) {
      (document as Document & { startViewTransition: (cb: () => void) => unknown }).startViewTransition(() => flushSync(commit))
    } else {
      commit()
    }
    // Fix round 5 (binding ruling on the review's C1/I1/I2): back through the router, not the raw
    // History API. `startTransition` marks the resulting remount as low priority, so React keeps
    // showing this instance's already-updated (optimistic) UI instead of yanking to `loading.tsx`
    // while the (by now prefetched, per `queueNext`) navigation resolves -- the remount is real,
    // but invisible. Kept OUTSIDE the `flushSync`/View Transition branch above on purpose:
    // `flushSync` forces a synchronous commit for the crossfade snapshot, which is the opposite of
    // what `startTransition` asks for, and the router call itself has nothing to do with the
    // in-page crossfade -- it needs to run exactly once regardless of which branch ran above.
    startTransition(() => { router.replace(url) })
  }

  const waitUntil = !hintTiming.first && hintTiming.coachAt !== null ? hintTiming.coachAt + LOCKDOWN.hintCooldownS * 1000 : hintTiming.failureAt !== null && !hintTiming.edited ? hintTiming.failureAt + LOCKDOWN.hintCooldownS * 1000 : 0
  const hintWaitSeconds = Math.max(0, Math.ceil((waitUntil - clock) / 1000))
  const hintAvailable = !busy && outcome === 'failed' && diagnosis !== null && hintCount < LOCKDOWN.maxHintsPerExercise && hintWaitSeconds === 0
  const controlsDisabled = busy || hasPending || outcome === 'passed' || !exercise
  // Fix round C2: `next()`'s own guard is `!completed.current || gate.current || pending.current`
  // -- once a background save fails after `completed.current` was already set (e.g. a CLO-close
  // Planner call throwing, or any failure reached after that point), `pending.current` stays set
  // forever and every click on "Next exercise" becomes a silent no-op while the button itself
  // still looked enabled (`disabled={busy}` had already gone false). `canAdvance` mirrors that
  // guard honestly so the button is disabled exactly when clicking it would do nothing.
  const canAdvance = outcome === 'passed' && (closed || nextExercise !== null) && !hasPending
  const judgeAbsent = exercise?.language === 'java' && judgeProviderAbsent()
  return { exercise, clo, code, setCode, run, submit, status, outcome, results, diagnosis, partialDiagnosis, hints, partialHint, hintPending, requestHint, next, review, nextExercise, progress, stdout, stderr, error, hintAvailable, hintWaitSeconds, hintCount, busy, controlsDisabled, retry, duringAttempt, pointsEarned, pointsProvisional, chain, closed, canAdvance, judgeAbsent, lastRewardAttempt, seededFromHandoffCode }
}
