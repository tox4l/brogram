'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowUpRight } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import type { CourseCode, LessonProgress } from '@/lib/contracts'
import { course as courseMeta, loadCourseBundle, loadedBundle, type CourseBundle } from '@/lib/curriculum'
import { buildMap, currentCloId, nextUp } from '@/lib/course/map'
import { qk } from '@/lib/query/keys'
import type { WellnessRow } from '@/lib/learner/compile'
import { resolveWellnessPrefs } from '@/lib/wellness/prefs'
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
 * already-loaded or already-in-flight request instantly). This is the only
 * fetch this screen makes (R5.1: zero Supabase round trips; the static
 * bundle is served from the CDN, cached with `?v=<hash>`, and shared with
 * every other screen that loads the same course in the same session).
 *
 * Wave-1-gate fix (I1): a switch from `/courses` or a hover/focus prefetch
 * already warms `loadedBundle(code)` before this component ever mounts --
 * the original version of this hook ignored that synchronous accessor and
 * always paid for one microtask through `loadCourseBundle`'s promise before
 * painting, which is exactly the "picks a course, course home paints
 * immediately" promise the plan names. The lazy `useState` initializer below
 * reads the synchronous cache on the very first render; the `if` block right
 * after re-checks it whenever `code` or `attempt` changes across renders of
 * the *same* mount (React's documented "adjust state during render" pattern
 * -- not a synchronous `setState` inside `useEffect`, which the standing
 * lint rule forbids). The effect below only ever calls `setState` inside the
 * promise callbacks, i.e. asynchronously.
 */
function useCourseBundle(code: CourseCode) {
  const [state, setState] = useState<BundleState | null>(() => {
    const cached = loadedBundle(code)
    return cached ? { code, bundle: cached, failed: false } : null
  })
  const [seenCode, setSeenCode] = useState(code)
  const [attempt, setAttempt] = useState(0)
  const [seenAttempt, setSeenAttempt] = useState(0)

  if (code !== seenCode || attempt !== seenAttempt) {
    setSeenCode(code)
    setSeenAttempt(attempt)
    const cached = loadedBundle(code)
    setState(cached ? { code, bundle: cached, failed: false } : null)
  }

  useEffect(() => {
    if (state && state.code === code) return
    let cancelled = false
    loadCourseBundle(code)
      .then((bundle) => { if (!cancelled) setState({ code, bundle, failed: false }) })
      .catch(() => { if (!cancelled) setState({ code, bundle: null, failed: true }) })
    return () => { cancelled = true }
  }, [code, state, attempt])

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
  const queryClient = useQueryClient()
  const userId = learnerState?.userId
  // Wave-1-gate fix (I2): a passive `getQueryData` peek here never re-rendered
  // when something else wrote this key, so a completed walkthrough kept
  // showing as card 1 after every reload. `queryFn: skipToken` keeps this a
  // subscription with no fetcher -- it never calls Supabase itself (T2.1 is
  // adding the server-side seed through `QuerySeed`; until then this reads
  // whatever `LessonView`'s own optimistic mutation already wrote into the
  // shared `QueryClient`) but DOES re-render this screen the moment the seed
  // or a later write lands, which a one-shot peek structurally cannot.
  const lessonProgressQuery = useQuery<LessonProgress[]>({
    queryKey: qk.lessonProgress(userId ?? ''),
    queryFn: skipToken,
    enabled: Boolean(userId),
  })
  const lessonProgress = lessonProgressQuery.data ?? []
  // A passive, non-fetching cache peek, same as `lessonProgress` used to be:
  // `wellness` is not seeded by the layout either, so a subscribing
  // `useWellness()` would fire a Supabase read on mount. Out of this fix
  // round's scope (only `lessonProgress` was named); left as a peek.
  // Standing constraint 12 -- the learner's own `motion` choice, not the raw
  // `prefers-reduced-motion` media query -- must still gate every animating
  // component here.
  const wellnessRow = userId ? queryClient.getQueryData<WellnessRow>(qk.wellness(userId)) : undefined
  const motionPref = resolveWellnessPrefs(wellnessRow?.prefs).motion
  const reducedMotion = useReducedMotion(motionPref)
  // Spec §10.4 restricted state: "map read-only, walkthroughs still open" --
  // the proxy already blocks `/exercise/*` itself; this only keeps the copy
  // honest instead of silently bouncing a restricted learner to /dashboard.
  const restricted = learnerState?.accountStatus === 'restricted'

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
  const nodes = buildMap({ clos: bundle.clos, code, mastery, lessonProgress, lessons: bundle.lessons, path })
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
        <PathMap nodes={nodes} exercises={bundle.exercises} reducedMotion={reducedMotion} restricted={restricted} />
      </section>

      <NextUpStack cards={cards} reducedMotion={reducedMotion} restricted={restricted} />

      <CourseFlatList nodes={nodes} exercises={bundle.exercises} reducedMotion={reducedMotion} restricted={restricted} />
    </div>
  )
}
