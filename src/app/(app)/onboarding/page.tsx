'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import type { ExercisePublic } from '@/lib/contracts'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { callAgent } from '@/lib/agents/client'
import { toExercisePublic } from '@/lib/learner/bank'
import { createClient } from '@/lib/supabase/client'
import { useSession } from '@/store/session'
import comingSoonSeed from '../../../../seed/courses.json'
import {
  FIRST_QUESTION, INITIAL_PROFILE, LANGUAGE_LABELS,
  mapCloRow, mergeProfileDelta, messageOf, phaseOfQuestion, writeLearnerState,
  type OnboardingQuestion, type WorkingProfile,
} from './lib'

type Stage = 'question' | 'course' | 'plan'
type LiveCourse = { code: string; slug: string; title: string; language: string; level: number }
type ComingSoonCourse = { slug: string; title: string; language: string }

/** Onboarding stays under four minutes; this is a hard client-side backstop on top of the agent's own cap. */
const MAX_QUESTIONS = 13
const COMING_SOON: ComingSoonCourse[] = comingSoonSeed.coming_soon

export default function Onboarding() {
  const session = useSession()
  const router = useRouter()
  const clientRef = useRef<ReturnType<typeof createClient> | null>(null)
  const client = useCallback(() => clientRef.current ??= createClient(), [])

  const [stage, setStage] = useState<Stage>('question')
  const [phase, setPhase] = useState<1 | 2>(1)
  const [question, setQuestion] = useState<OnboardingQuestion>(FIRST_QUESTION)
  const [answers, setAnswers] = useState<{ questionId: string; answer: string }[]>([])
  const [profile, setProfile] = useState<WorkingProfile>(INITIAL_PROFILE)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastActionRef = useRef<(() => Promise<void>) | null>(null)

  const [liveCourses, setLiveCourses] = useState<LiveCourse[] | null>(null)
  const [coursesLoading, setCoursesLoading] = useState(false)
  const [coursesError, setCoursesError] = useState<string | null>(null)
  const [selectedCourseTitle, setSelectedCourseTitle] = useState<string | null>(null)

  const userId = session.user?.id ?? null
  const version = session.learnerState?.version ?? 0
  const displayName = session.learnerState?.profile.displayName ?? ''

  const perform = useCallback(async (action: () => Promise<void>) => {
    lastActionRef.current = action
    setBusy(true); setError(null)
    try { await action() }
    catch (actionError) { setError(messageOf(actionError)) }
    finally { setBusy(false) }
  }, [])

  const retryLast = useCallback(() => {
    if (lastActionRef.current) void perform(lastActionRef.current)
  }, [perform])

  const submitAnswer = useCallback((option: string) => {
    if (!userId) return
    void perform(async () => {
      const nextAnswers = [...answers, { questionId: question.id, answer: option }]
      const envelope = await callAgent({
        agent: 'profiler', trigger: 'onboarding-answer', phase, answers: nextAnswers,
        state: { userId, version, profile: { ...profile, displayName } },
      })
      const reply = envelope.reply
      const merged = mergeProfileDelta(profile, reply.profileDelta)
      setAnswers(nextAnswers)
      setProfile(merged)
      if (!reply.nextQuestion || reply.done || nextAnswers.length >= MAX_QUESTIONS) { setStage('course'); return }
      setPhase(phaseOfQuestion(reply.nextQuestion.id))
      setQuestion(reply.nextQuestion)
    })
  }, [answers, displayName, perform, phase, profile, question.id, userId, version])

  const loadCourses = useCallback(() => {
    void (async () => {
      setCoursesLoading(true); setCoursesError(null)
      try {
        const { data, error: readError } = await client().from('courses').select('code,slug,title,language,level').eq('status', 'live').order('level').order('title')
        if (readError) throw readError
        setLiveCourses((data ?? []) as LiveCourse[])
      } catch (readError) { setCoursesError(messageOf(readError)) }
      finally { setCoursesLoading(false) }
    })()
  }, [client])

  useEffect(() => {
    if (stage === 'course' && liveCourses === null && !coursesLoading && !coursesError) loadCourses()
  }, [stage, liveCourses, coursesLoading, coursesError, loadCourses])

  const chooseCourse = useCallback((course: LiveCourse) => {
    if (!userId || !session.learnerState) return
    setSelectedCourseTitle(course.title)
    setStage('plan')
    void perform(async () => {
      const supabase = client()
      const { data: cloRows, error: cloError } = await supabase.from('clos').select('*').eq('course', course.code).eq('draft', false).order('ordinal')
      if (cloError) throw cloError
      const clos = (cloRows ?? []).map(mapCloRow)
      const firstThree = clos.slice(0, 3).map((clo) => clo.id)

      let candidateRows: ExercisePublic[] = []
      if (firstThree.length) {
        const { data: exerciseRows, error: exerciseError } = await supabase.from('exercises_public').select('*').in('clo_id', firstThree).eq('verified', true)
        if (exerciseError) throw exerciseError
        candidateRows = (exerciseRows ?? []).map(toExercisePublic)
      }
      const candidates = candidateRows.slice(0, 30).map(({ id, cloId, pattern, difficulty, title }) => ({ id, cloId, pattern, difficulty, title }))

      const plannerEnvelope = await callAgent({
        agent: 'planner', trigger: 'plan-refresh',
        state: { userId, version, profile: { ...profile, displayName }, mastery: {}, recentMistakes: [], currentCourse: course.code },
        course: course.code, clos, candidates,
      })
      const plan = plannerEnvelope.reply

      const nextState = await writeLearnerState(supabase, session.learnerState!, (base) => ({
        ...base,
        profile: { ...base.profile, ...profile, onboardingComplete: true },
        currentCourse: course.code,
        path: plan.path,
        nextExerciseIds: plan.nextExerciseIds,
        // `focus` is not part of the frozen LearnerState contract; it rides along as an
        // extra jsonb key so the dashboard and report can show the Planner's latest line.
        focus: plan.focus,
      }) as typeof base)
      session.setLearnerState(nextState)
      router.push('/dashboard')
    })
  }, [client, displayName, perform, profile, router, session, userId, version])

  if (!userId) return null

  const progressValue = Math.min(100, Math.round((answers.length / MAX_QUESTIONS) * 100))

  if (stage === 'question') {
    return (
      <div className="mx-auto max-w-2xl space-y-8 py-10">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{phase === 1 ? 'How you learn' : 'About you'}</span>
            <span>Question {Math.min(answers.length + 1, MAX_QUESTIONS)} of about {MAX_QUESTIONS}</span>
          </div>
          <Progress value={progressValue} aria-label="Onboarding progress" />
        </div>
        <h1 className="max-w-xl text-2xl font-medium leading-relaxed tracking-tight">{question.text}</h1>
        <div role="group" aria-label="Choose one" className="grid gap-3 sm:grid-cols-2">
          {question.options.map((option) => (
            <button key={option} type="button" disabled={busy} onClick={() => submitAnswer(option)}
              className="rounded-xl border border-border bg-card p-5 text-left text-sm font-medium leading-relaxed outline-none transition-colors hover:border-emerald-300 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:opacity-50 motion-reduce:transition-none">
              {option}
            </button>
          ))}
        </div>
        {busy && <StepLoading label="Finding your next question." />}
        {error && <ErrorRetry message={error} onRetry={retryLast} />}
      </div>
    )
  }

  if (stage === 'course') {
    return (
      <div className="mx-auto max-w-3xl space-y-10 py-10">
        <div className="space-y-2">
          <h1 className="text-2xl font-medium tracking-tight">Choose your course</h1>
          <p className="text-sm text-muted-foreground">You can change this anytime from your dashboard.</p>
        </div>
        {coursesLoading && <StepLoading label="Opening your courses." />}
        {coursesError && <ErrorRetry message={coursesError} onRetry={loadCourses} />}
        {!coursesLoading && !coursesError && liveCourses && (
          liveCourses.length ? (
            <div role="group" aria-label="Live courses" className="grid gap-3 sm:grid-cols-2">
              {liveCourses.map((course) => (
                <button key={course.code} type="button" disabled={busy} onClick={() => chooseCourse(course)}
                  className="group flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-5 text-left outline-none transition-colors hover:border-emerald-300 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:opacity-50 motion-reduce:transition-none">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{course.title}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{LANGUAGE_LABELS[course.language] ?? course.language}</span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-emerald-200" aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Courses are being prepared. Check back shortly.</p>
          )
        )}
        <div className="space-y-3 border-t border-border pt-6">
          <h2 className="text-xs font-medium text-muted-foreground">Coming soon</h2>
          <div role="group" aria-label="Coming soon" className="grid gap-3 sm:grid-cols-3">
            {COMING_SOON.map((course) => (
              <button key={course.slug} type="button" disabled aria-disabled="true"
                className="rounded-xl border border-dashed border-input p-4 text-left opacity-50">
                <span className="block text-sm font-medium">{course.title}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{LANGUAGE_LABELS[course.language] ?? course.language}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-xl space-y-6 py-16 text-center">
      <h1 className="text-2xl font-medium tracking-tight">Building your path</h1>
      <p className="text-sm text-muted-foreground">{selectedCourseTitle ? `Matching your first exercises in ${selectedCourseTitle}.` : 'Matching your first exercises.'}</p>
      <StepLoading label="Preparing your plan." />
      {error && <ErrorRetry message={error} onRetry={retryLast} />}
    </div>
  )
}

function StepLoading({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3 rounded-xl border border-dashed border-input p-5">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="size-2 animate-pulse rounded-full bg-emerald-300" aria-hidden="true" />
        {label}
      </div>
      <div className="h-2 w-2/3 animate-pulse rounded-full bg-muted" />
      <div className="h-2 w-1/2 animate-pulse rounded-full bg-muted" />
    </div>
  )
}

function ErrorRetry({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 p-4">
      <p className="min-w-0 flex-1 text-sm">{message}</p>
      <Button variant="outline" onClick={onRetry}>Try again</Button>
    </div>
  )
}
