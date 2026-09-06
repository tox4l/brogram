'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowUpRight } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import type { CourseCode, LessonProgress } from '@/lib/contracts'
import { course as courseMeta, loadCourseBundle, type CourseBundle } from '@/lib/curriculum'
import { buildMap, currentCloId, nextUp } from '@/lib/course/map'
import { qk } from '@/lib/query/keys'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'
import { PathMap } from '@/components/course/PathMap'
import { NextUpStack } from '@/components/course/NextUpStack'
import { CourseFlatList } from '@/components/course/CourseFlatList'
import { useSession } from '@/store/session'

const LANGUAGE_NAMES: Record<string, string> = {
  python: 'Python', javascript: 'JavaScript', typescript: 'TypeScript',
  java: 'Java', sql: 'SQL', mongo: 'MongoDB', web: 'HTML, CSS & JavaScript',
}

interface BundleState {
  code: CourseCode
  bundle: CourseBundle | null
  failed: boolean
}

/**
 * The static curriculum bundle, memoised per course in `@/lib/curriculum`
 * already (`loadCourseBundle`'s own module-level map dedupes an
 * already-loaded or already-in-flight request instantly) -- this hook is
 * just the local render-state wrapper (loading / loaded / failed), the same
 * shape `dashboard/page.tsx`'s `useCurriculum` uses for its own Supabase
 * reads. This is the only fetch this screen makes (R5.1: zero Supabase round
 * trips; the static bundle is served from the CDN, cached with `?v=<hash>`,
 * and shared with every other screen that loads the same course in the same
 * session). `setState` only ever runs inside the promise callbacks below --
 * never synchronously in the effect body itself.
 */
function useCourseBundle(code: CourseCode) {
  const [state, setState] = useState<BundleState | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    loadCourseBundle(code)
      .then((bundle) => { if (!cancelled) setState({ code, bundle, failed: false }) })
      .catch(() => { if (!cancelled) setState({ code, bundle: null, failed: true }) })
    return () => { cancelled = true }
  }, [code, attempt])

  const current = state && state.code === code ? state : null
  return {
    bundle: current?.bundle ?? null,
    loading: current === null,
    failed: current?.failed ?? false,
    retry: () => setAttempt((value) => value + 1),
  }
}

function ErrorRetry({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 p-4">
      <p className="min-w-0 flex-1 text-sm">{message}</p>
      <Button variant="outline" onClick={onRetry}>Try again</Button>
    </div>
  )
}

function BackLink() {
  return (
    <Link href="/courses" className="inline-flex items-center gap-1.5 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
      <ArrowLeft className="size-3" aria-hidden="true" />Courses
    </Link>
  )
}

export default function CoursePage() {
  const params = useParams<{ code: string }>()
  const code = decodeURIComponent(params.code)
  const meta = courseMeta(code)
  const { bundle, failed, retry } = useCourseBundle(code)
  // The layout server-renders `learnerState` into `SessionProvider` before
  // paint (spec R5.1): reading it here, not through a query, is what keeps
  // this screen at zero Supabase round trips on mount.
  const { learnerState } = useSession()
  const reducedMotion = useReducedMotion(undefined)
  const queryClient = useQueryClient()
  const userId = learnerState?.userId
  const lessonProgress = (userId ? queryClient.getQueryData<LessonProgress[]>(qk.lessonProgress(userId)) : undefined) ?? []

  if (!meta) {
    return (
      <section className="space-y-4 py-10">
        <BackLink />
        <h1 className="text-2xl font-medium tracking-tight">This course could not be found</h1>
        <p className="text-sm text-muted-foreground">Pick a course from your list instead.</p>
        <Link href="/courses" className={buttonVariants({ variant: 'outline' })}>Back to courses<ArrowUpRight aria-hidden="true" /></Link>
      </section>
    )
  }

  if (meta.status === 'coming-soon') {
    return (
      <section className="space-y-4 py-10">
        <BackLink />
        <h1 className="text-2xl font-medium tracking-tight">{meta.title} is not open yet</h1>
        <p className="text-sm text-muted-foreground">This course is on the way. Pick a live course for now.</p>
        <Link href="/courses" className={buttonVariants({ variant: 'outline' })}>Back to courses<ArrowUpRight aria-hidden="true" /></Link>
      </section>
    )
  }

  if (!bundle) {
    return (
      <section className="space-y-5 py-6">
        <BackLink />
        {failed
          ? <ErrorRetry message="This course could not open. Your saved progress is safe." onRetry={retry} />
          : <p role="status" className="text-sm text-muted-foreground">Opening {meta.title}.</p>}
      </section>
    )
  }

  const isCurrentCourse = learnerState?.currentCourse === code
  const mastery = learnerState?.mastery ?? {}
  const path = isCurrentCourse && learnerState
    ? learnerState.path
    : bundle.clos.slice().sort((a, b) => a.ordinal - b.ordinal).map((clo) => clo.id)
  const nextExerciseIds = isCurrentCourse && learnerState ? learnerState.nextExerciseIds : []

  const current = currentCloId(path, mastery)
  const nodes = buildMap({ clos: bundle.clos, code, mastery, lessonProgress })
  const cards = nextUp({ currentCloId: current, clos: bundle.clos, lessons: bundle.lessons, lessonProgress, nextExerciseIds, exercises: bundle.exercises })
  const lockedIn = nodes.filter((node) => node.state === 'locked-in').length

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <BackLink />
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="max-w-3xl text-2xl font-medium tracking-tight sm:text-3xl">{meta.title}</h1>
          <p className="font-mono text-xs text-muted-foreground">{LANGUAGE_NAMES[meta.language] ?? meta.language}</p>
        </div>
        <p className="text-sm text-muted-foreground">{lockedIn} of {nodes.length} skills locked in</p>
      </div>

      <section aria-labelledby="path-heading" className="space-y-4">
        <h2 id="path-heading" className="text-base font-medium">Your path</h2>
        <PathMap nodes={nodes} exercises={bundle.exercises} reducedMotion={reducedMotion} />
      </section>

      <NextUpStack cards={cards} />

      <CourseFlatList nodes={nodes} />
    </div>
  )
}
