'use client'

import { motion } from 'motion/react'
import type { CourseCode, Language } from '@/lib/contracts'
import { STAGGER } from '@/lib/motion/tokens'
import { cn } from '@/lib/utils'

const LANGUAGE_LABELS: Record<string, string> = {
  python: 'Python', javascript: 'JavaScript', typescript: 'TypeScript', java: 'Java',
  sql: 'SQL', mongo: 'MongoDB', web: 'HTML, CSS & JavaScript', cpp: 'C++', csharp: 'C#', php: 'PHP',
}

function ProgressRing({ value }: { value: number }) {
  const clamped = Math.min(100, Math.max(0, value))
  const radius = 15
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - clamped / 100)
  return (
    <span className="relative inline-flex size-10 shrink-0 items-center justify-center" role="img" aria-label={`${clamped} percent complete`}>
      <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true" className="-rotate-90">
        <circle cx="20" cy="20" r={radius} strokeWidth="4" className="fill-none stroke-muted" />
        <circle
          cx="20" cy="20" r={radius} strokeWidth="4" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          className="fill-none stroke-emerald-200"
        />
      </svg>
      <span className="absolute font-mono text-[10px] text-muted-foreground">{clamped}%</span>
    </span>
  )
}

export interface LiveCourseCardProps {
  status: 'live'
  code: CourseCode
  title: string
  language: Language
  level: number
  /** 0-100: closed CLOs over the course's total. */
  progress: number
  isCurrent: boolean
  /** Whether the learner already has a plan for this course. */
  hasPath: boolean
  /** Position in the grid; drives the entrance stagger (spec 10.7: 40ms per card, capped). */
  index: number
  reducedMotion: boolean
  onSelect: (code: CourseCode) => void
}

export interface ComingSoonCourseCardProps {
  status: 'coming-soon'
  title: string
  language: string
  /** Why it's disabled — always shown, never a bare grey-out (spec 10.7). */
  reason: string
  index: number
  reducedMotion: boolean
}

export type CourseCardProps = LiveCourseCardProps | ComingSoonCourseCardProps

function entranceProps(index: number, reducedMotion: boolean) {
  if (reducedMotion) return {}
  const delay = Math.min(index * STAGGER.step, STAGGER.max) / 1000
  return {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { delay, duration: 0.2 },
  }
}

export function CourseCard(props: CourseCardProps) {
  const entrance = entranceProps(props.index, props.reducedMotion)

  if (props.status === 'coming-soon') {
    return (
      <motion.div {...entrance}>
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="w-full rounded-xl border border-dashed border-input p-4 text-left opacity-60"
        >
          <span className="block text-sm font-medium">{props.title}</span>
          <span className="mt-1 block text-xs text-muted-foreground">{LANGUAGE_LABELS[props.language] ?? props.language}</span>
          <span className="mt-2 block text-xs text-muted-foreground">{props.reason}</span>
        </button>
      </motion.div>
    )
  }

  return (
    <motion.div {...entrance}>
      <motion.button
        type="button"
        onClick={() => props.onSelect(props.code)}
        whileTap={props.reducedMotion ? undefined : { scale: 0.98 }}
        aria-current={props.isCurrent ? 'true' : undefined}
        className={cn(
          'flex w-full items-center gap-4 rounded-xl border bg-card p-4 text-left outline-none transition-colors',
          'hover:border-emerald-300 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-emerald-300 motion-reduce:transition-none',
          props.isCurrent ? 'border-emerald-300' : 'border-border',
        )}
      >
        <ProgressRing value={props.progress} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="block truncate text-sm font-medium">{props.title}</span>
            {props.isCurrent && (
              <span className="shrink-0 rounded-full bg-emerald-200/20 px-2 py-0.5 text-[10px] font-medium text-emerald-200">Current</span>
            )}
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">{LANGUAGE_LABELS[props.language] ?? props.language} · Level {props.level}</span>
          <span className="mt-1 block text-xs text-muted-foreground">{props.hasPath ? 'You have a path here.' : 'No path started yet.'}</span>
        </span>
      </motion.button>
    </motion.div>
  )
}
