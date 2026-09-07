'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useRouter } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Attempt, BankQuery, Clo, CoachReply, DiagnoserReply, ExercisePublic, LearnerState, Mastery, PlannerReply, ReviewerReply, RunResult, TestResult } from '@/lib/contracts'
import { LOCKDOWN, pointsForPass } from '@/lib/contracts'
import { callAgent, streamAgent } from '@/lib/agents/client'
import { DEFAULT_DIFFICULTY, fetchBank, pickFromBank, toExercisePublic } from '@/lib/learner/bank'
import { nextInChain } from '@/lib/learner/chain'
import { applyFail, applyPass } from '@/lib/learner/score'
import { provisionalPlan } from '@/lib/learner/provisional'
import { getRuntime, judgeProviderAbsent, subscribeRuntimeProgress, type RuntimeProgress } from '@/lib/runtimes'
import { createClient } from '@/lib/supabase/client'
import { codeDiff, exerciseRunRequest, gradeAnswer, usesAnswerForm } from '@/lib/exercise/grading'
import { useSession } from '@/store/session'
import { clo as staticClo, closFor, course as staticCourse, courses as staticCourses, exerciseFrom } from '@/lib/curriculum'
import { buildRewardContext, type RewardAttempt } from '@/lib/rewards/context'
import { nextGoalDays, shouldRecordGoalDay } from '@/lib/rewards/goal'
import { crossedMilestone } from '@/lib/rewards/streaks'
import { celebrate, levelUpDetail, type CelebrationDetail, type CelebrationKind } from '@/lib/rewards/useCelebration'
import { play } from '@/lib/sound/manager'
import { prefsPatch, resolveWellnessPrefs } from '@/lib/wellness/prefs'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'
import { getQueryClient } from '@/lib/query/client'
import { qk } from '@/lib/query/keys'
import { line } from '@/lib/voice/lines'

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
  attempt: Attempt; exercise: ExercisePublic; clo: Clo; inserted: boolean
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
export function useExerciseLoop(exerciseId: string) {
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
  /** Fix round C1: set by `next()`'s in-place transition to the id it just switched TO, so
   *  the load effect -- which still fires because `exerciseId` (the URL param) changed --
   *  recognizes the exercise is already fully loaded and skips its own reset/reload entirely. */
  const handledExternally = useRef<string | null>(null)
  const reducedMotion = useReducedMotion()
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
   */
  function applyLoadedExercise(item: ExercisePublic, cloRow: Clo, coursePackages: string[], token: number) {
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
    const initialCode = usesAnswerForm(item) ? item.kind === 'spot-the-bug' ? '[]' : item.kind === 'trace' ? '{}' : '' : item.starterCode
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
    // Fix round C1: `next()` already loaded the target exercise synchronously and stamped its id
    // here before updating the URL -- this effect still fires (`exerciseId`, the URL param,
    // changed), but recognizes the work is already done and only re-arms the progress
    // subscription and the clock tick, never the reset-then-refetch cycle below.
    const alreadyHandled = handledExternally.current === exerciseId
    handledExternally.current = null
    const token = alreadyHandled ? generation.current : ++generation.current
    if (!alreadyHandled) { gate.current = false; completed.current = false; pending.current = null }
    const active = () => generation.current === token
    const unsubscribe = subscribeRuntimeProgress(event => {
      const loaded = exerciseRef.current
      if (active() && loaded && event.language === (loaded.kind === 'schema' ? 'sql' : loaded.language)) setProgress(event)
    })
    if (!alreadyHandled) {
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

  async function saveState(delta: (base: LearnerState) => LearnerState, token: number): Promise<LearnerState> {
    const client = clientRef.current!; const local = assertAllowed()
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: row, error: readError } = await client.from('learner_state').select('state,version').eq('user_id', local.userId).maybeSingle()
      if (generation.current !== token) throw new Error(line('rep.changed.presave'))
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
      if (generation.current !== token) throw new Error(line('rep.changed.postsave'))
      sessionRef.current.setLearnerState(nextState)
      return nextState
    }
    throw new Error(line('rep.retry.elsewhere'))
  }

  async function queueNext(operation: Submission, token: number) {
    const client = clientRef.current!; const state = operation.state!
    const mastery = state.mastery[operation.exercise.cloId]
    if (mastery.closed) {
      // CLOs are always static curriculum data, never runtime-generated (R5.1b) -- no `clos` read.
      const clos = [...closFor(operation.clo.course)]
      if (!operation.planner) {
        const flatBanks = (await Promise.all(clos.map(item => fetchBank(client, { cloId: item.id })))).flat()
        if (generation.current !== token) return
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
      if (generation.current !== token) return
      if (!operation.planned) {
        const plan = operation.planner!
        try {
          // `focus` is not part of the frozen LearnerState contract; it rides along as an
          // extra jsonb key so the dashboard and report can show the Planner's latest line.
          operation.state = await saveState(base => ({ ...base, path: plan.path, nextExerciseIds: plan.nextExerciseIds, focus: plan.focus }) as typeof base, token)
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
      return
    }
    const inChain = mastery.chain > 0 ? mastery.patternsPassed.slice(-mastery.chain) : []
    // Calling the frozen function with the existing last pattern does not advance it.
    const preferences = nextInChain(mastery, operation.exercise.pattern, operation.clo.patterns).preferPatterns
    const query: BankQuery = { cloId: operation.clo.id, difficulty: DEFAULT_DIFFICULTY, preferPatterns: preferences, excludePatterns: inChain, excludeExerciseIds: history.current.map(attempt => attempt.exercise_id) }
    const bank = await fetchBank(client, query)
    if (generation.current !== token) return
    let chosen = pickFromBank(query, bank)
    if (!chosen) {
      try {
        const pattern = preferences[0]
        if (!pattern) throw new Error('No different pattern is available for this outcome.')
        const exampleIds = [...new Set(bank.map(item => item.id))].slice(0, 2)
        if (exampleIds.length < 2) throw new Error('Two distinct CLO examples are required before an exercise can be authored.')
        const parent = history.current.filter(attempt => attempt.passed && bank.some(item => item.id === attempt.exercise_id)).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0]?.exercise_id ?? operation.exercise.id
        const authored = await callAgent({ agent: 'author', trigger: 'bank-miss', state, clo: operation.clo, language: operation.exercise.language, kind: operation.exercise.kind, difficulty: DEFAULT_DIFFICULTY, pattern, exampleIds, parentExerciseId: parent })
        if (generation.current !== token) return
        const generated = authored.reply.exercise as typeof authored.reply.exercise & { id?: unknown }
        if (typeof generated.id !== 'string' || !generated.id || generated.cloId !== operation.clo.id || generated.pattern !== pattern || inChain.includes(generated.pattern) || !generated.tests.length) throw new Error('The generated exercise did not match this chain.')
        const { referenceSolution, ...publicFields } = generated
        const publicExercise: ExercisePublic = { ...publicFields, id: generated.id, origin: 'generated', parentExerciseId: parent }
        const request = exerciseRunRequest(publicExercise, referenceSolution, true, packages.current)
        const verified = usesAnswerForm(publicExercise) ? gradeAnswer(publicExercise, referenceSolution) : await getRuntime(request.language).run(request)
        if (!verified.ok || verified.totalCount !== publicExercise.tests.length || verified.passedCount !== publicExercise.tests.length) throw new Error('The generated reference did not pass every test.')
        if (generation.current !== token) return
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
    if (generation.current !== token) return
    setNextExercise(chosen); operation.queued = true
  }

  /**
   * Fix round I5: `shouldRecordGoalDay`/`nextGoalDays` (src/lib/rewards/goal.ts) had no
   * producer anywhere in the tree, so `goal.done` could never fire. The pass path is the only
   * place that advances a win count, so it is the only place that can decide this -- but
   * `wellness.prefs` has no shared mutation exported outside `src/components/wellness/Dock.tsx`
   * (T2.4's file, not in this task's Files list this wave). Rather than reach into that
   * component or add a new file outside this fix round's committed paths, this mirrors its
   * read-merge-write shape locally: a fresh read (never the possibly-stale query cache, since
   * this decides whether to *write*), `prefsPatch` to keep the row diff-shaped, and the same
   * update-then-insert-if-absent fallback. Degrades silently on any failure -- a missed goal
   * day is a missed celebration, never a broken pass -- and never awaited by the caller.
   *
   * `lessonProgress`/`drillResults` are empty here (this hook only ever sees exercise
   * attempts), so `winsToday` under-counts a learner who also finished a walkthrough or a
   * de-rot run today; the exercise-only count it still gets is honest, just partial, and never
   * over-fires (an under-count can only delay `goalMet`, never fake it early).
   */
  async function recordGoalAndStreak(client: SupabaseClient, userId: string, state: LearnerState, createdAt: string) {
    try {
      const { data } = await client.from('wellness').select('prefs').eq('user_id', userId).maybeSingle()
      const prefs = resolveWellnessPrefs((data as { prefs: unknown } | null)?.prefs)
      const rewardAttempts: RewardAttempt[] = history.current.map(row => ({ id: row.id, userId, exerciseId: row.exercise_id, code: '', results: [], passed: row.passed, durationMs: 0, hintCount: row.hint_count, createdAt: row.created_at }))
      const ctx = buildRewardContext({ state, attempts: rewardAttempts, activityDays: [], lessonProgress: [], drillResults: [], prefs, courseLessonCounts: {}, now: new Date(createdAt) })
      if (!shouldRecordGoalDay(ctx)) return
      const goalDays = nextGoalDays(ctx)
      if (!goalDays) return
      const patch = prefsPatch({ ...prefs, goalDays })
      const updated = await client.from('wellness').update({ prefs: patch, updated_at: new Date().toISOString() }).eq('user_id', userId).select('user_id').maybeSingle()
      if (!updated.data) await client.from('wellness').insert({ user_id: userId, prefs: patch })
      // Fix round 2, N2: the dock's goal ring, `SoundToggle` and `DockControl` all read
      // `qk.wellness` from the shared query cache (seeded once by `QuerySeed`, never refetched
      // on focus) -- without this, the ring silently stops moving for the rest of the session
      // the moment the learner actually hits their goal.
      void getQueryClient().invalidateQueries({ queryKey: qk.wellness(userId) })
      fireCelebration('goal', undefined, `${userId}:goal:${ctx.today}`)
    } catch (goalError) {
      console.warn("Could not record today's goal; the pass itself is unaffected.", goalError)
    }
  }

  async function finishSubmission(operation: Submission, token: number) {
    const client = clientRef.current!; const attempt = operation.attempt
    if (!operation.inserted) {
      const { error: insertError } = await client.from('attempts').upsert({ id: attempt.id, user_id: attempt.userId, exercise_id: attempt.exerciseId, code: attempt.code, results: attempt.results, passed: attempt.passed, duration_ms: attempt.durationMs, hint_count: attempt.hintCount, created_at: attempt.createdAt }, { onConflict: 'id', ignoreDuplicates: true })
      if (insertError) throw insertError
      operation.inserted = true
      if (generation.current !== token) return
      history.current.unshift({ id: attempt.id, exercise_id: attempt.exerciseId, passed: attempt.passed, hint_count: attempt.hintCount, created_at: attempt.createdAt })
    }
    if (generation.current !== token) return
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
      if (generation.current !== token) return
      setReview(operation.review)
      // Step 2: the tween IS the reconciliation -- fires the instant the real quality lands,
      // not after the slower mastery-save/queueNext chain below.
      setPointsEarned(pointsForPass(operation.exercise.difficulty, attempt.hintCount, operation.review.quality))
      setPointsProvisional(false)
    } else {
      if (!operation.diagnosis) {
        operation.diagnosis = (await streamAgent({ agent: 'diagnoser', trigger: 'attempt-failed', state, exercise: { ...exerciseRefForAgent, kind: operation.exercise.kind }, code: attempt.code, results: attempt.results }, partial => { if (generation.current === token) setPartialDiagnosis(partial) })).reply
      }
      if (generation.current !== token) return
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
        return { ...base, currentCourse: operation.clo.course, mastery: { ...base.mastery, [operation.exercise.cloId]: mastery }, points: base.points + scored.points, recentMistakes: mistakes, streak: activityStreak(base, attempt.createdAt) }
      }, token)
    }
    if (generation.current !== token) return
    let mastery = operation.state.mastery[operation.exercise.cloId]
    if (!operation.masterySaved) {
      // A state write may have succeeded before a retry. Repair from the newest
      // document and condition the row update so an older tab cannot roll it back.
      const latest = await client.from('learner_state').select('state,version').eq('user_id', attempt.userId).maybeSingle()
      if (latest.error) throw latest.error
      if (generation.current !== token) return
      if (latest.data?.state?.mastery?.[operation.exercise.cloId] && latest.data.version >= operation.state.version) {
        operation.state = { ...latest.data.state, version: latest.data.version } as LearnerState
        mastery = operation.state.mastery[operation.exercise.cloId]
      }
      const row = { user_id: mastery.userId, clo_id: mastery.cloId, score: mastery.score, chain: mastery.chain, patterns_passed: mastery.patternsPassed, closed: mastery.closed, last_attempt_at: mastery.lastAttemptAt }
      const inserted = await client.from('mastery').upsert(row, { onConflict: 'user_id,clo_id', ignoreDuplicates: true })
      if (inserted.error) throw inserted.error
      if (generation.current !== token) return
      const updated = await client.from('mastery').update(row).eq('user_id', mastery.userId).eq('clo_id', mastery.cloId).or(`last_attempt_at.is.null,last_attempt_at.lte."${mastery.lastAttemptAt ?? attempt.createdAt}"`).select('clo_id').maybeSingle()
      if (updated.error) throw updated.error
      if (!updated.data) throw new Error(line('rep.stale.mastery'))
      operation.masterySaved = true
    }
    if (generation.current !== token) return
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
      // Goal-day + `goal.done`: best-effort, fire-and-forget -- never blocks the pass or the
      // save above. See `recordGoalAndStreak`'s own comment for the ownership note.
      void recordGoalAndStreak(client, attempt.userId, operation.state, attempt.createdAt)
      if (!operation.queued) await queueNext(operation, token)
      if (generation.current !== token) return
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
  async function syncInBackground(operation: Submission, token: number) {
    try { await finishSubmission(operation, token) }
    catch (syncError) { if (generation.current === token) { setError(messageOf(syncError)); setPartialDiagnosis(null); setPartialHint(null) } }
    finally {
      // A graded submission settling (pass, fail, or a background failure the retry banner
      // covers) is exactly the moment the dashboard's streak, goal ring, points and trophy
      // shelf go stale: `attempts` and `activityDays` change on every attempt (spec's own
      // `activityStreak` counts a fail too), `achievements` and `learner_state` on a pass.
      // `saveState` predates T0.4's `useOptimistic` and keeps its own version-guarded retry
      // loop rather than being rebuilt on it this task, so unlike a `useOptimistic` mutation
      // there is no automatic self-invalidation on the `learner-state` key -- invalidated
      // explicitly here alongside the other three so a stale reload is never required.
      const userId = sessionRef.current.user?.id
      if (userId) {
        const client = getQueryClient()
        void client.invalidateQueries({ queryKey: qk.attempts(userId) })
        void client.invalidateQueries({ queryKey: qk.activityDays(userId) })
        void client.invalidateQueries({ queryKey: qk.achievements(userId) })
        void client.invalidateQueries({ queryKey: qk.learnerState(userId) })
      }
    }
  }

  async function submit() {
    const item = exerciseRef.current; const cloRow = cloRef.current
    if (!item || !cloRow || completed.current || pending.current) return
    const token = generation.current
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
      const request = exerciseRunRequest(item, submittedCode, true, packages.current)
      const result: RunResult = usesAnswerForm(item) ? gradeAnswer(item, submittedCode) : await getRuntime(request.language).run(request)
      if (generation.current !== token) return
      setResults(result.results); setStdout(''); setStderr(''); setDuringAttempt(false); startedAt.current = null
      const previousTime = history.current[0]?.created_at ? Date.parse(history.current[0].created_at) : 0
      const at = new Date(Math.max(Date.now(), Number.isFinite(previousTime) ? previousTime + 1 : 0)).toISOString()
      const passedNow = result.ok && result.totalCount === item.tests.length && result.passedCount === item.tests.length
      const attemptId = crypto.randomUUID()
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
      } else {
        setChain(0)
        play('fail')
      }

      await syncInBackground(operation, token)
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
    if (operation) { const token = generation.current; await operate(() => syncInBackground(operation, token), 'submitting') }
    else if (!exerciseRef.current) setReload(value => value + 1)
    else { setError(null); setStatus(completed.current ? 'passed' : failureAt.current === null ? 'ready' : 'failed') }
  }

  /**
   * Fix round C1: `next()` no longer routes through the load effect's reset-then-refetch cycle
   * at all -- `nextExercise` is already a complete `ExercisePublic` (fetched by `queueNext`'s
   * bank query or Author generation), so `applyLoadedExercise` swaps it in directly and
   * synchronously. `handledExternally` tells the effect (which still fires once `exerciseId`,
   * the URL param, catches up) that this transition is already done. `router.replace` is
   * bookmarking, not data-fetching -- history-replace semantics because a chain of reps
   * should not pile up the back stack.
   *
   * Fix round I1: the browser's native View Transition needs the DOM change to happen
   * *synchronously inside* its callback, or it captures old-to-old and crossfades nothing
   * (confirmed: `router.replace` alone never satisfies this, since the URL/param update is
   * itself asynchronous). `flushSync` forces React to commit `applyLoadedExercise`'s state
   * updates before the callback returns, which is the documented way to pair React with this
   * API absent React's own `<ViewTransition>` component (not exported by this tree's pinned
   * React 19.2.8 -- see report). The prompt panel carries the transition name (`page.tsx`) so
   * only it crossfades; the editor and the warm runtime never remount either way.
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
    const commit = () => {
      const token = ++generation.current
      handledExternally.current = target.id
      applyLoadedExercise(target, cloRow, coursePackages, token)
      router.replace(url)
    }
    if (!reducedMotion && typeof document !== 'undefined' && 'startViewTransition' in document) {
      (document as Document & { startViewTransition: (cb: () => void) => unknown }).startViewTransition(() => flushSync(commit))
    } else {
      commit()
    }
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
  return { exercise, clo, code, setCode, run, submit, status, outcome, results, diagnosis, partialDiagnosis, hints, partialHint, hintPending, requestHint, next, review, nextExercise, progress, stdout, stderr, error, hintAvailable, hintWaitSeconds, hintCount, busy, controlsDisabled, retry, duringAttempt, pointsEarned, pointsProvisional, chain, closed, canAdvance, judgeAbsent, lastRewardAttempt }
}
