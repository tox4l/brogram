'use client'

import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import coursesSeed from '../../../../seed/courses.json'
import { Section } from './Section'

const LANGUAGE_LABELS: Record<string, string> = {
  python: 'Python', javascript: 'JavaScript', typescript: 'TypeScript',
  java: 'Java', sql: 'SQL', mongo: 'MongoDB', web: 'HTML, CSS & JavaScript', cpp: 'C++', csharp: 'C#', php: 'PHP',
}

const PHASE_1_QUESTION = { text: 'When you get stuck on a problem, what helps you most?', options: ['Seeing a worked example first', 'Working through the theory, then trying it'] }
const PHASE_2_QUESTION = { text: 'What made you want to learn to code?', options: ['I want to build my own small tools.', "It's required for my degree, and I'd like to actually understand it."] }

/**
 * Reproduces the card compositions from src/app/(app)/onboarding/page.tsx (phase-1
 * either-or, phase-2 motivation, course picker) with static state instead of the
 * real page's Profiler/Planner agent calls and Supabase course reads.
 */
export function OnboardingSection() {
  const [phase, setPhase] = useState<1 | 2>(1)
  const [selected, setSelected] = useState<string | null>(null)
  const question = phase === 1 ? PHASE_1_QUESTION : PHASE_2_QUESTION
  const liveCourses = coursesSeed.courses.filter((course) => course.status === 'live')
  const comingSoonFromCourses = coursesSeed.courses.filter((course) => course.status !== 'live').map(({ slug, title, language }) => ({ slug, title, language }))
  const comingSoon = [...comingSoonFromCourses, ...coursesSeed.coming_soon]

  return (
    <Section id="onboarding" title="Onboarding" caption="Static reproduction of the phase-1 either-or card, the phase-2 motivation card, and the course picker (INFS3102 as a coming-soon tile); no Profiler or Planner calls.">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4 rounded-xl border border-border p-6">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{phase === 1 ? 'How you learn' : 'About you'}</span>
            <span>Question {phase} of about 10</span>
          </div>
          <Progress value={phase === 1 ? 15 : 60} aria-label="Onboarding progress" />
          <h3 className="max-w-xl text-xl font-medium leading-relaxed tracking-tight">{question.text}</h3>
          <div role="group" aria-label="Choose one" className="grid gap-3 sm:grid-cols-2">
            {question.options.map((option) => (
              <button key={option} type="button"
                onClick={() => { setSelected(option); setPhase((current) => (current === 1 ? 2 : 1)) }}
                className="rounded-xl border border-border bg-card p-5 text-left text-sm font-medium leading-relaxed outline-none transition-colors hover:border-emerald-300 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-emerald-300 motion-reduce:transition-none">
                {option}
              </button>
            ))}
          </div>
          {selected && <p className="text-xs text-muted-foreground">Last answer: {selected}</p>}
        </div>

        <div className="space-y-4 rounded-xl border border-border p-6">
          <h3 className="text-sm font-medium text-muted-foreground">Course picker</h3>
          <div role="group" aria-label="Live courses" className="grid gap-3 sm:grid-cols-2">
            {liveCourses.map((course) => (
              <button key={course.code} type="button" disabled
                className="group flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 text-left opacity-90">
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{course.title}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{LANGUAGE_LABELS[course.language] ?? course.language}</span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            ))}
          </div>
          <div className="space-y-3 border-t border-border pt-4">
            <h4 className="text-xs font-medium text-muted-foreground">Coming soon</h4>
            <div role="group" aria-label="Coming soon" className="grid gap-3 sm:grid-cols-3">
              {comingSoon.map((course) => (
                <button key={course.slug} type="button" disabled aria-disabled="true"
                  className="rounded-xl border border-dashed border-input p-3 text-left opacity-50">
                  <span className="block text-xs font-medium">{course.title}</span>
                  <span className="mt-1 block text-[11px] text-muted-foreground">{LANGUAGE_LABELS[course.language] ?? course.language}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Section>
  )
}
