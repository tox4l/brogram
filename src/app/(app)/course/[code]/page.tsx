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
import { Reveal } from '@/components/motion/Reveal'
import { ShaderSurface } from '@/components/visual/ShaderSurface'
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
      <p className="min-w-0 flex-1 text-body text-foreground">{message}</p>
      <Button variant="outline" onClick={onRetry}>Try again</Button>
    </div>
  )
}

function BackLink() {
  return (
    <Link href="/courses" className="inline-flex items-center gap-1 rounded-lg text-small text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
      <ArrowLeft className="size-4" aria-hidden="true" />Courses
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
      <section className="space-y-4 py-8">
        <BackLink />
        <h1 className="text-h1 font-display text-foreground">This course could not be found</h1>
        <p className="text-body text-muted-foreground">Pick a course from your list instead.</p>
        <Link href="/courses" className={buttonVariants({ variant: 'outline' })}>Back to courses<ArrowUpRight aria-hidden="true" /></Link>
      </section>
    )
  }

  if (meta.status === 'coming-soon') {
    return (
      <section className="space-y-4 py-8">
        <BackLink />
        <h1 className="text-h1 font-display text-foreground">{meta.title} is not open yet</h1>
        <p className="text-body text-muted-foreground">This course is on the way. Pick a live course for now.</p>
        <Link href="/courses" className={buttonVariants({ variant: 'outline' })}>Back to courses<ArrowUpRight aria-hidden="true" /></Link>
      </section>
    )
  }

  if (!bundle) {
    return (
      <section className="space-y-4 py-6">
        <BackLink />
        {failed
          ? <ErrorRetry message="This course could not open. Saved progress is safe." onRetry={retry} />
          : <p role="status" className="text-body text-muted-foreground">Opening {meta.title}.</p>}
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
      <div className="space-y-3">
        <BackLink />
        {/* The one hero band that earns a shader (spec §9, "/course/[code]"):
         *  full-bleed inside this box only, Eclipse only, frozen at 4500ms --
         *  a static duotone CSS floor everywhere else (`ShaderSurface`'s own
         *  contract). The title sits on an opaque scrim panel rather than
         *  directly over the field, because standing rule 6 (spec §6.2) bans
         *  text over live shader pixels with nothing intervening. */}
        <div className="relative min-h-48 overflow-hidden rounded-2xl">
          <ShaderSurface motionPref={motionPref} className="z-0" />
          <div className="relative z-10 flex min-h-48 flex-col justify-end gap-2 p-6">
            {/* Fix round (review M3): bg-card, not bg-background/95 -- an opaque
             *  real surface tier, matching spec §9's "CLO text ... on solid
             *  --card" rather than a near-invisible scrim in Folio. */}
            <div className="w-fit max-w-full rounded-xl bg-card px-4 py-3">
              <p className="font-mono text-micro text-muted-foreground uppercase">{LANGUAGE_NAMES[meta.language] ?? meta.language}</p>
              {/* Fix round (review I1): 68ch never binds at --text-hero/56px
               *  (~2500px) -- dropped rather than swapped, since nothing this
               *  wide needs a measure cap. */}
              <h1 className="mt-1 text-hero font-display text-foreground">
                {/* `mode="fade"` deliberately, not "words": a course code is
                 *  dynamic, server-supplied content, and `no-agent-surfaces.
                 *  test.tsx` (frozen, not owned by this task) asserts on the
                 *  exact literal title text via `findByText`, which a real
                 *  `SplitText.create` word-split would break by putting the
                 *  string across several text nodes. `mode="fade"` never
                 *  calls `SplitText` at all (Reveal.tsx's own contract),
                 *  so the DOM keeps one contiguous text node while still
                 *  giving the hero its once-per-mount reveal. */}
                <Reveal mode="fade" reduced={reducedMotion}>{meta.title}</Reveal>
              </h1>
            </div>
          </div>
        </div>
        <p className="text-body text-muted-foreground">{lockedIn} of {nodes.length} skills locked in</p>
      </div>

      <section aria-labelledby="path-heading" className="space-y-4">
        <h2 id="path-heading" className="text-h3 text-foreground">Path map</h2>
        <PathMap nodes={nodes} exercises={bundle.exercises} reducedMotion={reducedMotion} restricted={restricted} />
      </section>

      <NextUpStack cards={cards} reducedMotion={reducedMotion} restricted={restricted} />

      <CourseFlatList nodes={nodes} exercises={bundle.exercises} reducedMotion={reducedMotion} restricted={restricted} />
    </div>
  )
}
