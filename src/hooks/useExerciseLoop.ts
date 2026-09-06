'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Attempt, BankQuery, Clo, CoachReply, DiagnoserReply, ExercisePublic, LearnerState, Mastery, PlannerReply, ReviewerReply, RunResult, TestResult } from '@/lib/contracts'
import { LOCKDOWN, pointsForPass } from '@/lib/contracts'
import { callAgent, streamAgent } from '@/lib/agents/client'
import { DEFAULT_DIFFICULTY, fetchBank, pickFromBank, toExercisePublic } from '@/lib/learner/bank'
import { nextInChain } from '@/lib/learner/chain'
import { applyFail, applyPass } from '@/lib/learner/score'
import { getRuntime, subscribeRuntimeProgress, type RuntimeProgress } from '@/lib/runtimes'
import { createClient } from '@/lib/supabase/client'
import { codeDiff, exerciseRunRequest, gradeAnswer, usesAnswerForm } from '@/lib/exercise/grading'
import { useSession } from '@/store/session'

type Status = 'loading' | 'ready' | 'running' | 'submitting' | 'failed' | 'passed' | 'error'
type History = { id: string; exercise_id: string; passed: boolean; hint_count: number; created_at: string }
type Submission = {
  attempt: Attempt; exercise: ExercisePublic; clo: Clo; inserted: boolean
  diagnosis?: DiagnoserReply; review?: ReviewerReply; state?: LearnerState
  masterySaved?: boolean; planned?: boolean; planner?: PlannerReply; queued?: boolean
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
const mapClo = (row: Record<string, unknown>): Clo => ({ id: String(row.id), course: String(row.course), ordinal: Number(row.ordinal), outcome: String(row.outcome), topics: row.topics as string[] ?? [], prerequisites: row.prerequisites as string[] ?? [], patterns: row.patterns as string[] ?? [], assessableInCode: row.assessable_in_code === true })

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
  const [exercise, setExercise] = useState<ExercisePublic | null>(null)
  const [clo, setClo] = useState<Clo | null>(null)
  const [code, updateCode] = useState(''); const [status, setStatus] = useState<Status>('loading')
  const [results, setResults] = useState<TestResult[]>([])
  const [diagnosis, setDiagnosis] = useState<DiagnoserReply | null>(null)
  const [partialDiagnosis, setPartialDiagnosis] = useState<Partial<DiagnoserReply> | null>(null)
  const [hints, setHints] = useState<CoachReply[]>([]); const hintsRef = useRef<CoachReply[]>([])
  const [partialHint, setPartialHint] = useState<Partial<CoachReply> | null>(null)
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

  useEffect(() => {
    try { sessionStorage.setItem('brogram:attempt-active', String(duringAttempt)) } catch { /* Wellness remains usable without storage. */ }
    return () => { try { sessionStorage.setItem('brogram:attempt-active', 'false') } catch { /* Storage is optional. */ } }
  }, [duringAttempt])

  useEffect(() => {
    const token = ++generation.current
    gate.current = false; completed.current = false; pending.current = null
    exerciseRef.current = null; cloRef.current = null; startedAt.current = null
    failureAt.current = null; lastCoachAt.current = null; spentHints.current = 0; hintsRef.current = []; editedAfterFailure.current = false
    failureId.current = null; hintedFailureId.current = null
    const active = () => generation.current === token
    const unsubscribe = subscribeRuntimeProgress(event => {
      const loaded = exerciseRef.current
      if (active() && loaded && event.language === (loaded.kind === 'schema' ? 'sql' : loaded.language)) setProgress(event)
    })
    void (async () => {
      await Promise.resolve()
      if (!active()) return
      setExercise(null); setClo(null); setStatus('loading'); setError(null); setBusy(false)
      setResults([]); setDiagnosis(null); setPartialDiagnosis(null); setHints([]); setPartialHint(null)
      setReview(null); setNextExercise(null); setProgress(null); setStdout(''); setStderr('')
      setHintCount(0); setDuringAttempt(false); setPointsEarned(0); setClosed(false)
      setHasPending(false)
      setHintTiming({ failureAt: null, coachAt: null, edited: false, first: true }); setClock(Date.now())
      try {
        const client = clientRef.current ??= createClient()
        const userId = sessionRef.current.user?.id
        if (!userId) throw new Error('Sign in to open an exercise.')
        const { data: row, error: readError } = await client.from('exercises_public').select('*').eq('id', exerciseId).eq('verified', true).maybeSingle()
        if (readError) throw readError
        if (!row) throw new Error('This exercise is unavailable. Choose another from your dashboard.')
        const item = toExercisePublic(row)
        const [cloResult, attempts] = await Promise.all([
          client.from('clos').select('*').eq('id', item.cloId).eq('draft', false).maybeSingle(),
          client.from('attempts').select('id,exercise_id,passed,hint_count,created_at').eq('user_id', userId).order('created_at', { ascending: false }),
        ])
        if (cloResult.error) throw cloResult.error
        if (attempts.error) throw attempts.error
        if (!cloResult.data) throw new Error('This learning outcome is unavailable.')
        const outcome = mapClo(cloResult.data)
        const course = await client.from('courses').select('packages').eq('code', outcome.course).maybeSingle()
        if (course.error) throw course.error
        if (!active()) return
        packages.current = course.data?.packages ?? []; history.current = attempts.data ?? []
        const receipt = readHintReceipt(userId, item.id)
        const used = Math.min(LOCKDOWN.maxHintsPerExercise, Math.max(receipt.count, ...history.current.filter(attempt => attempt.exercise_id === item.id).map(attempt => attempt.hint_count ?? 0)))
        lastCoachAt.current = receipt.calledAt; hintsRef.current = receipt.hints; setHints(receipt.hints)
        hintedFailureId.current = receipt.failureId
        setHintTiming({ failureAt: null, coachAt: receipt.calledAt, edited: false, first: true })
        spentHints.current = used; setHintCount(used)
        exerciseRef.current = item; cloRef.current = outcome
        const initialCode = usesAnswerForm(item) ? item.kind === 'spot-the-bug' ? '[]' : item.kind === 'trace' ? '{}' : '' : item.starterCode
        codeRef.current = initialCode; updateCode(initialCode); setExercise(item); setClo(outcome); setStatus('ready')
        if (!usesAnswerForm(item)) {
          try { await getRuntime(item.kind === 'schema' ? 'sql' : item.language).warmup() }
          catch (warmupError) { if (active()) setError(`Runtime preparation failed: ${messageOf(warmupError)}. Run or submit to retry.`) }
        }
      } catch (loadError) { if (active()) { setError(messageOf(loadError)); setStatus('error') } }
    })()
    const timer = window.setInterval(() => { if (active()) setClock(Date.now()) }, 1000)
    return () => {
      generation.current = token + 1; unsubscribe(); window.clearInterval(timer)
      const item = exerciseRef.current
      if (item && !usesAnswerForm(item) && gate.current) getRuntime(item.kind === 'schema' ? 'sql' : item.language).abort()
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
    if (!currentSession.user || !currentSession.learnerState) throw new Error('Your session is unavailable. Sign in again.')
    const profile = currentSession.profile
    if (profile?.account_status === 'banned' || profile?.account_status === 'restricted' && (!profile.restricted_until || Date.parse(profile.restricted_until) >= Date.now())) throw new Error('Exercises are paused for this account. Return to your dashboard.')
    return currentSession.learnerState
  }

  async function saveState(delta: (base: LearnerState) => LearnerState, token: number): Promise<LearnerState> {
    const client = clientRef.current!; const local = assertAllowed()
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: row, error: readError } = await client.from('learner_state').select('state,version').eq('user_id', local.userId).maybeSingle()
      if (generation.current !== token) throw new Error('Exercise changed before progress could be saved.')
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
      if (generation.current !== token) throw new Error('Exercise changed while progress was saved.')
      sessionRef.current.setLearnerState(nextState)
      return nextState
    }
    throw new Error('Progress changed in another tab. Try saving again.')
  }

  async function queueNext(operation: Submission, token: number) {
    const client = clientRef.current!; const state = operation.state!
    const mastery = state.mastery[operation.exercise.cloId]
    if (mastery.closed) {
      if (!operation.planner) {
        const { data, error: cloError } = await client.from('clos').select('*').eq('course', operation.clo.course).eq('draft', false)
        if (cloError) throw cloError
        const clos = (data ?? []).map(mapClo)
        const banks = await Promise.all(clos.map(item => fetchBank(client, { cloId: item.id })))
        if (generation.current !== token) return
        operation.planner = (await callAgent({ agent: 'planner', trigger: 'plan-refresh', state, course: operation.clo.course, clos, candidates: banks.flat().slice(0, 30).map(({ id, cloId, pattern, difficulty, title }) => ({ id, cloId, pattern, difficulty, title })) })).reply
      }
      if (generation.current !== token) return
      if (!operation.planned) {
        const plan = operation.planner
        operation.state = await saveState(base => ({ ...base, path: plan!.path, nextExerciseIds: plan!.nextExerciseIds }), token)
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
          const { data, error: fallbackError } = await client.from('clos').select('*').eq('course', operation.clo.course).eq('draft', false)
          if (fallbackError) throw fallbackError
          const nearby = (await Promise.all((data ?? []).map(item => fetchBank(client, { cloId: String(item.id) })))).flat()
          chosen = nearby.filter(item => item.id !== operation.exercise.id && item.pattern !== operation.exercise.pattern).sort((a, b) => Math.abs(a.difficulty - DEFAULT_DIFFICULTY) - Math.abs(b.difficulty - DEFAULT_DIFFICULTY))[0] ?? null
        }
        if (!chosen) throw new Error('You passed. The next exercise is still being prepared; return to the dashboard.')
      }
    }
    if (generation.current !== token) return
    setNextExercise(chosen); operation.queued = true
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
    const exerciseRefForAgent = { id: operation.exercise.id, cloId: operation.exercise.cloId, pattern: operation.exercise.pattern, prompt: operation.exercise.prompt, language: operation.exercise.language }
    if (attempt.passed) {
      if (!operation.review) operation.review = (await callAgent({ agent: 'reviewer', trigger: 'attempt-passed', state, exercise: exerciseRefForAgent, code: attempt.code, hintCount: attempt.hintCount, durationMs: attempt.durationMs })).reply
      if (generation.current !== token) return
      setReview(operation.review)
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
        if (previous.lastAttemptAt && Date.parse(previous.lastAttemptAt) > Date.parse(attempt.createdAt)) throw new Error('Your attempt was saved, but newer progress exists in another tab. Return to the dashboard before continuing; this older result has not been applied again.')
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
      if (!updated.data) throw new Error('Your attempt was saved, but newer mastery exists in another tab. Return to the dashboard to refresh it.')
      operation.masterySaved = true
    }
    if (generation.current !== token) return
    if (attempt.passed) {
      completed.current = true
      setPointsEarned(pointsForPass(operation.exercise.difficulty, attempt.hintCount, operation.review!.quality))
      setClosed(mastery.closed)
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

  async function submit() {
    const item = exerciseRef.current; const outcome = cloRef.current
    if (!item || !outcome || completed.current || pending.current) return
    const token = generation.current
    await operate(async () => {
      const state = assertAllowed(); const submittedCode = codeRef.current; const submittedAt = Date.now()
      const durationMs = Math.max(0, submittedAt - (startedAt.current ?? submittedAt))
      if (!item.tests.length) throw new Error('This exercise has no grading tests. Choose another exercise.')
      if (submittedCode.length > 20_000) throw new Error('Keep your solution under 20,000 characters before submitting.')
      const request = exerciseRunRequest(item, submittedCode, true, packages.current)
      const result: RunResult = usesAnswerForm(item) ? gradeAnswer(item, submittedCode) : await getRuntime(request.language).run(request)
      if (generation.current !== token) return
      setResults(result.results); setStdout(''); setStderr(''); setDuringAttempt(false); startedAt.current = null
      const previousTime = history.current[0]?.created_at ? Date.parse(history.current[0].created_at) : 0
      const at = new Date(Math.max(Date.now(), Number.isFinite(previousTime) ? previousTime + 1 : 0)).toISOString()
      const passed = result.ok && result.totalCount === item.tests.length && result.passedCount === item.tests.length
      const operation: Submission = { exercise: item, clo: outcome, inserted: false, attempt: { id: crypto.randomUUID(), userId: state.userId, exerciseId: item.id, code: submittedCode, results: result.results, passed, hintCount: spentHints.current, durationMs, createdAt: at } }
      pending.current = operation; setHasPending(true); setDiagnosis(null); setPartialDiagnosis(null)
      await finishSubmission(operation, token)
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
      const reply = await streamAgent({ agent: 'coach', trigger: 'hint-requested', state, exercise: { id: item.id, cloId: item.cloId, pattern: item.pattern, prompt: item.prompt, language: item.language }, diffSinceLastHint: item.kind === 'code' ? codeDiff(lastHintCode.current, currentCode) : '', currentCode, fixPlan: diagnosis.fixPlan, hintsSoFar: hintsRef.current.map(previous => previous.hint) }, partial => { receivedPartial = true; if (generation.current === token) setPartialHint(partial) })
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
    finally { if (generation.current === token) { setPartialHint(null); setBusy(false); gate.current = false } }
  }

  async function retry() {
    if (gate.current) return
    const operation = pending.current
    if (operation) { const token = generation.current; await operate(() => finishSubmission(operation, token), 'submitting') }
    else if (!exerciseRef.current) setReload(value => value + 1)
    else { setError(null); setStatus(completed.current ? 'passed' : failureAt.current === null ? 'ready' : 'failed') }
  }

  async function next() {
    if (!completed.current || gate.current || pending.current) return
    if (closed) router.push('/dashboard')
    else if (nextExercise) router.push(`/exercise/${encodeURIComponent(nextExercise.id)}`)
  }

  const waitUntil = !hintTiming.first && hintTiming.coachAt !== null ? hintTiming.coachAt + LOCKDOWN.hintCooldownS * 1000 : hintTiming.failureAt !== null && !hintTiming.edited ? hintTiming.failureAt + LOCKDOWN.hintCooldownS * 1000 : 0
  const hintWaitSeconds = Math.max(0, Math.ceil((waitUntil - clock) / 1000))
  const hintAvailable = !busy && status === 'failed' && diagnosis !== null && hintCount < LOCKDOWN.maxHintsPerExercise && hintWaitSeconds === 0
  const controlsDisabled = busy || hasPending || status === 'passed' || !exercise
  return { exercise, clo, code, setCode, run, submit, status, results, diagnosis, partialDiagnosis, hints, partialHint, requestHint, next, review, nextExercise, progress, stdout, stderr, error, hintAvailable, hintWaitSeconds, hintCount, busy, controlsDisabled, retry, duringAttempt, pointsEarned, closed }
}
