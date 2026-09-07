'use client'

import Link from 'next/link'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { AppShell } from '@/components/shell/AppShell'
import { SessionProvider } from '@/components/shell/SessionProvider'
import { cn } from '@/lib/utils'
import type { Difficulty } from '@/lib/contracts'
import { difficultyWord } from '@/lib/voice/glossary'
import {
  fixtureCourse, fixtureLearnerState, fixtureNextExercises, fixtureOutcomes, fixtureSessionData,
} from '../fixtures'
import { Section, SectionErrorBoundary } from './Section'

const LANGUAGE_LABEL: Record<string, string> = { python: 'Python', javascript: 'JavaScript', java: 'Java', sql: 'SQL', mongo: 'MongoDB', web: 'HTML, CSS & JavaScript', typescript: 'TypeScript' }

function Statistic({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div role="group" aria-label={label} className="min-w-0 py-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1.5 font-mono text-xl font-medium tracking-tight text-foreground">{value}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{note}</p>
    </div>
  )
}

/**
 * Mirrors src/app/(app)/dashboard/page.tsx's sections and copy, but with fixture
 * data assigned directly instead of the real page's useCurriculum() hook, since
 * that hook fetches from Supabase and would only ever show its failed state
 * against the placeholder env. The real dashboard exports no prop-injectable
 * inner component, so this reproduces its composition per the task's fallback.
 */
function PreviewDashboard() {
  const course = fixtureCourse
  const completed = fixtureOutcomes.filter((outcome) => fixtureLearnerState.mastery[outcome.id]?.closed).length
  const exerciseDays = fixtureLearnerState.streak.exerciseDays
  const derotDays = fixtureLearnerState.streak.derotDays
  const displayName = fixtureLearnerState.profile.displayName

  return (
    <div className="space-y-7">
      <div>
        <h1 className="max-w-4xl text-2xl font-medium tracking-tight sm:text-3xl">Keep building, {displayName}.</h1>
        <p className="mt-2 text-sm text-muted-foreground">A little practice. A clearer understanding.</p>
      </div>

      <section id="course" aria-labelledby="preview-course-heading" className="scroll-mt-6 rounded-xl border border-border bg-linear-to-br from-emerald-200/[0.06] to-transparent p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h3 id="preview-course-heading" className="text-xs font-medium text-muted-foreground">Current course</h3>
            <p className="mt-2 text-xl font-medium tracking-tight">{course.title}</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{LANGUAGE_LABEL[course.language] ?? course.language} · {completed} of {fixtureOutcomes.length} outcomes complete</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{fixtureLearnerState.focus}</p>
          </div>
          <span className={cn(buttonVariants({ variant: 'outline' }), 'h-9 pointer-events-none opacity-80')}>Change course<ArrowUpRight aria-hidden="true" /></span>
        </div>
      </section>

      <div className="grid grid-cols-3 gap-3 border-b border-border pb-5 sm:gap-6">
        <Statistic label="Exercise streak" value={`${exerciseDays} days`} note="One day at a time." />
        <Statistic label="De-rot streak" value={`${derotDays} days`} note="Attention takes practice." />
        <Statistic label="Points" value={fixtureLearnerState.points.toLocaleString('en-US')} note="Earned through practice." />
      </div>

      <section aria-labelledby="preview-next-heading">
        <div className="flex items-baseline justify-between gap-3">
          <h3 id="preview-next-heading" className="text-base font-medium">Next exercises</h3>
          <p className="text-xs text-muted-foreground">Practice path</p>
        </div>
        <ol className="mt-3 divide-y divide-border border-y border-border">
          {fixtureNextExercises.map((exercise, index) => (
            <li key={exercise.id}>
              <span className="flex items-center gap-4 rounded-md py-4">
                <span className="w-5 shrink-0 font-mono text-xs text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">{exercise.title}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{LANGUAGE_LABEL[exercise.language] ?? exercise.language} · {difficultyWord(exercise.difficulty as Difficulty)}</span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-primary" aria-hidden="true" />
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="preview-mastery-heading">
        <div className="flex items-baseline justify-between gap-3">
          <h3 id="preview-mastery-heading" className="text-base font-medium">Course mastery</h3>
          <p className="text-xs text-muted-foreground">{completed} / {fixtureOutcomes.length} complete</p>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {fixtureOutcomes.map((outcome) => {
            const mastery = fixtureLearnerState.mastery[outcome.id]
            const score = mastery?.score ?? 0
            return (
              <div key={outcome.id} className="rounded-lg border border-border p-4">
                <div className="flex items-center justify-between gap-3 text-xs"><span className="text-muted-foreground">Outcome {outcome.ordinal}</span><span className={mastery?.closed ? 'text-primary' : 'text-muted-foreground'}>{mastery?.closed ? 'Complete' : mastery ? 'In progress' : 'Not started'}</span></div>
                <h4 className="mt-2 text-sm font-medium leading-relaxed">
                  {outcome.outcome}
                  {outcome.draft && <span className="ml-2 align-middle text-[10px] font-normal tracking-wide text-muted-foreground uppercase">Draft outcome</span>}
                </h4>
                <div className="mt-4 flex items-center gap-3"><Progress value={score} aria-label={outcome.outcome} className="flex-1" /><span className="font-mono text-xs text-muted-foreground">{score}%</span></div>
              </div>
            )
          })}
        </div>
      </section>

      <section aria-label="De-rot practice" className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5">
        <div><h3 className="text-sm font-medium">A change of pace</h3><p className="mt-1 text-sm text-muted-foreground">Keep your attention streak going with a short drill.</p></div>
        <Link href="/derot" className="inline-flex items-center gap-2 rounded-sm text-sm font-medium text-primary outline-none hover:text-primary/80 focus-visible:ring-2 focus-visible:ring-ring">Try a de-rot drill<ArrowUpRight className="size-4" aria-hidden="true" /></Link>
      </section>
    </div>
  )
}

export function ShellDashboardSection() {
  return (
    <Section id="shell-dashboard" title="Shell and dashboard" caption="The real AppShell (nav, wellness rail, buddy button) around a fixture SessionProvider and a dashboard composition matching the real page's sections and copy. The wellness rail and buddy button read from Supabase and degrade to their empty state since every fetch fails here.">
      <SectionErrorBoundary>
        <div className="rounded-xl border border-border">
          <SessionProvider initialState={fixtureSessionData}>
            <AppShell>
              <PreviewDashboard />
            </AppShell>
          </SessionProvider>
        </div>
      </SectionErrorBoundary>
    </Section>
  )
}
