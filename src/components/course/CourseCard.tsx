'use client'

import Link from 'next/link'
import { motion } from 'motion/react'
import type { CourseCode, Language } from '@/lib/contracts'
import { STAGGER } from '@/lib/motion/tokens'
import { Reveal } from '@/components/motion/Reveal'
import { cn } from '@/lib/utils'

/** A `<Link>` is what actually gets prefetched (spec 4.3 / wave-1 review I1) —
 *  a `<button>` with a `router.push` in its `onClick` never does, on this or
 *  any other route. `motion.create` wraps the real `next/link` component so
 *  the press-scale (`whileTap`) still animates the element the browser will
 *  actually navigate from. */
const MotionLink = motion.create(Link)

const LANGUAGE_LABELS: Record<string, string> = {
  python: 'Python', javascript: 'JavaScript', typescript: 'TypeScript', java: 'Java',
  sql: 'SQL', mongo: 'MongoDB', web: 'HTML, CSS & JavaScript', cpp: 'C++', csharp: 'C#', php: 'PHP',
}

function ProgressRing({ value, label }: { value: number; label: string }) {
  const clamped = Math.min(100, Math.max(0, value))
  const radius = 15
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - clamped / 100)
  return (
    // Same `role="progressbar"` + `aria-valuenow` convention as the dashboard's
    // linear <Progress> (src/app/(app)/dashboard/page.tsx) — one indicator
    // pattern across the app, not two.
    <span
      className="relative inline-flex size-10 shrink-0 items-center justify-center"
      role="progressbar" aria-label={label} aria-valuenow={clamped} aria-valuemin={0} aria-valuemax={100}
    >
      <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true" className="-rotate-90">
        <circle cx="20" cy="20" r={radius} strokeWidth="4" className="fill-none stroke-muted" />
        <circle
          cx="20" cy="20" r={radius} strokeWidth="4" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          className="fill-none stroke-primary"
        />
      </svg>
      <span className="absolute font-mono text-micro tabular text-muted-foreground">{clamped}%</span>
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
        {/* Not `disabled`: a disabled button is unreachable by keyboard, which would
            hide the reason from anyone tabbing through instead of clicking. This is
            reachable and announced but does nothing — there is nothing to select. */}
        <button
          type="button"
          aria-disabled="true"
          onClick={(event) => event.preventDefault()}
          className="w-full cursor-default rounded-xl border-t-2 border-rule bg-background p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {/* Fix round (review M2): no reveal here -- coming-soon tiles are the
              restricted-adjacent state (spec §9/§8 want that surface quiet),
              not a second stage for the word-reveal the live cards below get. */}
          <span className="block text-body font-medium text-foreground">{props.title}</span>
          <span className="mt-1 block text-small text-muted-foreground">{LANGUAGE_LABELS[props.language] ?? props.language}</span>
          <span className="mt-2 block text-small text-muted-foreground">{props.reason}</span>
        </button>
      </motion.div>
    )
  }

  return (
    <motion.div {...entrance}>
      <MotionLink
        href={`/course/${props.code}`}
        prefetch
        // Runs synchronously before Next's own `linkClicked` navigation call
        // (next/dist/client/app-dir/link.js: the user `onClick` fires, then
        // the router transition starts, in that order, in the same handler) —
        // the optimistic switch (store, then the cache via `mutation.mutate`)
        // is therefore always under way before the destination route paints.
        onClick={() => props.onSelect(props.code)}
        whileTap={props.reducedMotion ? undefined : { scale: 0.98 }}
        aria-current={props.isCurrent ? 'true' : undefined}
        className={cn(
          'flex w-full items-center gap-4 rounded-xl border bg-card p-4 text-left shadow-xs outline-none transition-colors',
          'hover:border-primary hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
          props.isCurrent ? 'border-primary' : 'border-rule',
        )}
      >
        <ProgressRing value={props.progress} label={`${props.title} progress`} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="block text-h2 text-foreground line-clamp-2">
              <Reveal mode="words" reduced={props.reducedMotion}>{props.title}</Reveal>
            </span>
            {props.isCurrent && (
              <span className="shrink-0 rounded-full bg-primary/20 px-2 py-1 text-micro font-medium text-primary">Current</span>
            )}
          </span>
          <span className="mt-1 block text-small text-muted-foreground">{LANGUAGE_LABELS[props.language] ?? props.language} · Level {props.level}</span>
          <span className="mt-1 block text-small text-muted-foreground">{props.hasPath ? 'You have a path here.' : 'No path started yet.'}</span>
        </span>
      </MotionLink>
    </motion.div>
  )
}
