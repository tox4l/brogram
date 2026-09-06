'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, ArrowUpRight, LockKeyhole } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import type { LearnerState } from '@/lib/contracts'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { useSession } from '@/store/session'

/**
 * The Planner's `focus` line is not part of the frozen LearnerState contract; it rides
 * along as an extra jsonb key written by onboarding and by useExerciseLoop's plan-refresh
 * on CLO close. This sentence is the same fallback the Planner itself uses when it has
 * nothing to say yet (see src/lib/agents/planner.ts and the reports page).
 */
const FOCUS_FALLBACK = 'Your next exercises are still being prepared.'

type CourseDetails = { code: string; title: string; language: string }
type OutcomeDetails = { id: string; ordinal: number; outcome: string }
type ExerciseDetails = { id: string; title: string; difficulty: number; language: string; clo_id: string }
type Curriculum = { course: CourseDetails | null; outcomes: OutcomeDetails[]; exercises: ExerciseDetails[] }
type CurriculumResult = { key: string; data: Curriculum | null; failed: boolean }

const languages: Record<string, string> = {
  python: 'Python', javascript: 'JavaScript', typescript: 'TypeScript',
  java: 'Java', sql: 'SQL', mongo: 'MongoDB', web: 'HTML, CSS & JavaScript',
}

function useCurriculum(userId: string | null, courseCode: string | null, exerciseKey: string) {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<CurriculumResult | null>(null)
  const key = JSON.stringify([userId, courseCode, exerciseKey, attempt])
  const needed = Boolean(userId && (courseCode || exerciseKey !== '[]'))

  useEffect(() => {
    if (!needed) return
    let cancelled = false

    async function load() {
      try {
        const client = createClient()
        const ids: string[] = JSON.parse(exerciseKey)
        const [course, outcomes, exercises] = await Promise.all([
          courseCode ? client.from('courses').select('code,title,language').eq('code', courseCode).maybeSingle() : { data: null, error: null },
          courseCode ? client.from('clos').select('id,ordinal,outcome').eq('course', courseCode).eq('draft', false).order('ordinal') : { data: [], error: null },
          ids.length ? client.from('exercises_public').select('id,title,difficulty,language,clo_id').in('id', ids) : { data: [], error: null },
        ])
        if (course.error || outcomes.error || exercises.error) throw new Error('Curriculum unavailable')
        if (!cancelled) setResult({
          key, failed: false,
          data: { course: course.data, outcomes: outcomes.data ?? [], exercises: exercises.data ?? [] },
        })
      } catch {
        if (!cancelled) setResult({ key, data: null, failed: true })
      }
    }

    void load()
    return () => { cancelled = true }
  }, [courseCode, exerciseKey, key, needed])

  // A changed account, course, or plan must never render the previous response.
  const current = needed && result?.key === key ? result : null
  return {
    data: current?.data ?? null,
    failed: current?.failed ?? false,
    loading: needed && !current,
    retry: () => setAttempt((value) => value + 1),
  }
}

function Statistic({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div role="group" aria-label={label} className="min-w-0 py-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1.5 font-mono text-xl font-medium tracking-tight text-foreground">{value}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{note}</p>
    </div>
  )
}

export default function Dashboard() {
  const { user, learnerState, profile } = useSession()
  const exerciseIds = [...new Set(learnerState?.nextExerciseIds ?? [])].slice(0, 3)
  const curriculum = useCurriculum(user?.id ?? null, learnerState?.currentCourse ?? null, JSON.stringify(exerciseIds))
  const { course, outcomes, exercises } = curriculum.data ?? { course: null, outcomes: [], exercises: [] }
  const orderedExercises = exerciseIds.flatMap((id) => {
    const exercise = exercises.find((item) => item.id === id)
    return exercise ? [exercise] : []
  })
  const restricted = profile?.account_status === 'restricted'
  const focusLine = (learnerState as (LearnerState & { focus?: string }) | null)?.focus || FOCUS_FALLBACK
  const displayName = learnerState?.profile.displayName.trim()
  const exerciseDays = learnerState?.streak.exerciseDays ?? 0
  const derotDays = learnerState?.streak.derotDays ?? 0
  const completed = outcomes.filter((outcome) => learnerState?.mastery[outcome.id]?.closed).length

  return (
    <div className="space-y-7">
      <div>
        <h1 className="max-w-4xl text-2xl font-medium tracking-tight sm:text-3xl">{displayName ? `Keep building, ${displayName}.` : 'Your next step starts here.'}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{learnerState?.currentCourse ? 'A little practice. A clearer understanding.' : 'Choose a course and make space for your first small win.'}</p>
      </div>

      <section id="course" aria-labelledby="course-heading" className="scroll-mt-6 rounded-xl border border-border bg-linear-to-br from-emerald-200/[0.06] to-transparent p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h2 id="course-heading" className="text-xs font-medium text-muted-foreground">Current course</h2>
            <p className="mt-2 text-xl font-medium tracking-tight">{course?.title ?? (curriculum.loading ? 'Opening your course' : curriculum.failed ? 'Your course details are unavailable' : 'Find your starting point.')}</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{course ? `${languages[course.language] ?? course.language} · ${completed} of ${outcomes.length} outcomes complete` : learnerState?.currentCourse ? 'Your saved progress is kept below.' : 'A course gives your practice a direction. You can change it anytime.'}</p>
            {learnerState?.currentCourse && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{focusLine}</p>}
          </div>
          <Link href="/onboarding" className={cn(buttonVariants({ variant: learnerState?.currentCourse ? 'outline' : 'default' }), learnerState?.currentCourse ? 'h-9' : 'h-9 bg-emerald-200 text-primary-foreground hover:bg-emerald-100')}>
            {learnerState?.currentCourse ? 'Change course' : 'Choose a course'}<ArrowUpRight aria-hidden="true" />
          </Link>
        </div>
      </section>

      <div className="grid grid-cols-3 gap-3 border-b border-border pb-5 sm:gap-6">
        <Statistic label="Exercise streak" value={`${exerciseDays} ${exerciseDays === 1 ? 'day' : 'days'}`} note={exerciseDays ? 'One day at a time.' : 'Your first pass starts it.'} />
        <Statistic label="De-rot streak" value={`${derotDays} ${derotDays === 1 ? 'day' : 'days'}`} note={derotDays ? 'Attention takes practice.' : 'Make time for a short drill.'} />
        <Statistic label="Points" value={(learnerState?.points ?? 0).toLocaleString('en-US')} note="Earned through practice." />
      </div>

      {curriculum.loading && <p role="status" className="text-sm text-muted-foreground">Loading your course and exercise details. Your saved progress is ready.</p>}
      {curriculum.failed && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-input p-4">
          <p className="text-sm text-foreground">Course and exercise details could not load. Your saved progress is still here.</p>
          <Button variant="outline" onClick={curriculum.retry}>Try again</Button>
        </div>
      )}

      <section aria-labelledby="next-heading">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="next-heading" className="text-base font-medium">Next exercises</h2>
          {orderedExercises.length > 0 && <p className="text-xs text-muted-foreground">Your practice path</p>}
        </div>
        {restricted && <p className="mt-2 text-sm text-muted-foreground">Exercises are paused while your account is restricted.</p>}
        {orderedExercises.length ? (
          <ol className="mt-3 divide-y divide-border border-y border-border">
            {orderedExercises.map((exercise, index) => {
              const contents = <><span className="w-5 shrink-0 font-mono text-xs text-muted-foreground">{String(index + 1).padStart(2, '0')}</span><span className="min-w-0 flex-1"><span className="block text-sm font-medium text-foreground">{exercise.title}</span><span className="mt-1 block text-xs text-muted-foreground">{languages[exercise.language] ?? exercise.language} · Difficulty {exercise.difficulty} of 5</span></span>{restricted ? <LockKeyhole className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : <ArrowRight className="size-4 shrink-0 text-emerald-200" aria-hidden="true" />}</>
              return <li key={exercise.id}>{restricted ? <div className="flex items-center gap-4 py-4">{contents}</div> : <Link href={`/exercise/${encodeURIComponent(exercise.id)}`} className="flex items-center gap-4 rounded-md py-4 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-emerald-300 motion-reduce:transition-none">{contents}</Link>}</li>
            })}
          </ol>
        ) : (
          <div className="mt-3 rounded-xl border border-dashed border-input p-5">
            <p className="text-sm font-medium">{curriculum.loading ? 'Your recommendations are on their way.' : curriculum.failed ? 'Your exercise list is waiting to reconnect.' : exerciseIds.length ? 'These exercises are no longer available.' : 'Your next exercises start here.'}</p>
            <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-muted-foreground">{exerciseIds.length ? 'Review your course to prepare a fresh practice path.' : 'Once your course and learning profile are ready, your next three exercises will appear here.'}</p>
            {!curriculum.loading && !curriculum.failed && exerciseIds.length > 0 && <Link href="/onboarding" className="mt-3 inline-block rounded-sm text-sm font-medium text-emerald-200 outline-none focus-visible:ring-2 focus-visible:ring-emerald-300">Review your course</Link>}
          </div>
        )}
        {orderedExercises.length > 0 && orderedExercises.length < exerciseIds.length && <p className="mt-3 text-sm text-muted-foreground">Some recommendations are no longer available. Change your course to refresh your path.</p>}
      </section>

      <section aria-labelledby="mastery-heading">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="mastery-heading" className="text-base font-medium">Course mastery</h2>
          {outcomes.length > 0 && <p className="text-xs text-muted-foreground">{completed} / {outcomes.length} complete</p>}
        </div>
        {outcomes.length ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {outcomes.map((outcome) => {
              const mastery = learnerState?.mastery[outcome.id]
              const score = mastery?.score ?? 0
              return (
                <div key={outcome.id} className="rounded-lg border border-border p-4">
                  <div className="flex items-center justify-between gap-3 text-xs"><span className="text-muted-foreground">Outcome {outcome.ordinal}</span><span className={mastery?.closed ? 'text-emerald-200' : 'text-muted-foreground'}>{mastery?.closed ? 'Complete' : mastery ? 'In progress' : 'Not started'}</span></div>
                  <h3 className="mt-2 text-sm font-medium leading-relaxed">{outcome.outcome}</h3>
                  <div className="mt-4 flex items-center gap-3"><Progress value={score} aria-label={outcome.outcome} className="flex-1 [&_[data-slot=progress-indicator]]:bg-emerald-200" /><span className="font-mono text-xs text-muted-foreground">{score}%</span></div>
                </div>
              )
            })}
          </div>
        ) : <div className="mt-3 rounded-xl border border-dashed border-input p-5"><p className="text-sm font-medium">{curriculum.loading ? 'Opening your learning outcomes.' : curriculum.failed ? 'Your mastery details will return when reconnected.' : 'Your outcomes will appear here.'}</p><p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">Practice across different patterns to build confidence in each outcome.</p></div>}
      </section>

      <section aria-label="De-rot practice" className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5">
        <div><h2 className="text-sm font-medium">A change of pace</h2><p className="mt-1 text-sm text-muted-foreground">{derotDays > 0 ? 'Keep your attention streak going with a short drill.' : 'Train your attention with a short coding drill.'}</p></div>
        <Link href="/derot" className="inline-flex items-center gap-2 rounded-sm text-sm font-medium text-emerald-200 outline-none hover:text-emerald-100 focus-visible:ring-2 focus-visible:ring-emerald-300">Try a de-rot drill<ArrowUpRight className="size-4" aria-hidden="true" /></Link>
      </section>
    </div>
  )
}
