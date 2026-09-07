'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { CourseCode, LearnerState } from '@/lib/contracts'
import { closFor, liveCourses, loadCourseBundle, loadedBundle } from '@/lib/curriculum'
import { provisionalPlan, type ProvisionalPlan } from '@/lib/learner/provisional'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'
import { qk } from '@/lib/query/keys'
import { useLearnerState, useWellness } from '@/lib/query/hooks'
import { useOptimistic } from '@/lib/query/optimistic'
import { createClient } from '@/lib/supabase/client'
import { resolveWellnessPrefs } from '@/lib/wellness/prefs'
import { useSession } from '@/store/session'
import { CourseCard } from '@/components/course/CourseCard'
import { courseProgress, messageOf, switchCourse, withCoursePlan } from './lib'

export type ComingSoonCourse = { slug: string; title: string; language: string }
const COMING_SOON_REASON = 'Not open yet. More courses are on the way.'

type SwitchVars = {
  code: CourseCode
  plan: ProvisionalPlan
  /** Bumped on every tap; a run whose token has been superseded by a later
   *  tap bails out of `switchCourse` before it writes anything (I3). */
  token: number
  /** The store/cache value from immediately before this tap — the exact
   *  snapshot `onError` restores on failure, tied to this call rather than a
   *  shared mutable ref, so two overlapping switches can never roll back to
   *  the wrong one's "before". */
  previousState: LearnerState
}

/**
 * V7: the "coming soon" list arrives as a prop from the server component in
 * `page.tsx` instead of this file importing `seed/courses.json` itself.
 * `page.tsx` has no `'use client'` directive, so its import of that JSON
 * (and the internal authoring note that lives elsewhere in the same file,
 * on a *live* course entry) never crosses into the client module graph --
 * only the plain `{slug, title, language}` values passed as `comingSoon`
 * below are serialized into this component's props (spec doc "Server and
 * Client Components": "Any props passed from a Server Component to a
 * Client Component" is the whole of what crosses the boundary).
 */
export function CoursesClient({ comingSoon }: { comingSoon: readonly ComingSoonCourse[] }) {
  const router = useRouter()
  const userId = useSession((session) => session.user?.id ?? null)
  const setLearnerState = useSession((session) => session.setLearnerState)
  // V4 / A11Y-03: a bare call means "system" -- defer entirely to the OS and
  // never see a learner who set `wellness.prefs.motion` on an OS with no
  // preference of its own (the exact case `useReducedMotion`'s own contract
  // names). `(app)/layout.tsx` already seeds this query, so reading it here
  // costs no extra request.
  const wellnessQuery = useWellness()
  const motionPref = resolveWellnessPrefs(wellnessQuery.data?.prefs).motion
  const reducedMotion = useReducedMotion(motionPref)
  const learnerStateQuery = useLearnerState()
  const learnerState = learnerStateQuery.data ?? null
  const [chipDismissed, setChipDismissed] = useState(false)
  const switchTokenRef = useRef(0)
  const pendingCodeRef = useRef<CourseCode | null>(null)

  const courses = useMemo(() => liveCourses(), [])

  useEffect(() => {
    // Best-effort warmth only (spec 4.3 step 2: "data already in the bundle").
    // Nothing downstream depends on this finishing before a tap — a tap that
    // lands before a bundle loads just gets a thinner provisional plan.
    for (const course of courses) void loadCourseBundle(course.code)
  }, [courses])

  const mutation = useMutation(useOptimistic<LearnerState | undefined, SwitchVars>({
    key: qk.learnerState(userId ?? ''),
    apply: (previous, vars) => (previous ? withCoursePlan(previous, vars.code, vars.plan) : previous),
    mutate: async (vars) => {
      try {
        if (!userId) throw new Error('The session has changed. Sign in again to switch courses.')
        const client = createClient()
        const result = await switchCourse({
          client, userId, code: vars.code, fallback: vars.previousState,
          isSuperseded: () => switchTokenRef.current !== vars.token,
        })
        if (!result) return // superseded by a later tap — the newer switch owns the outcome
        setLearnerState(result.state)
        if (result.pathTuned) toast('Path tuned.')
      } catch (error) {
        // The query cache's half of the rollback still runs after this rethrow —
        // `useOptimistic`'s own `onError` restores the exact prior snapshot. This
        // is the store's half of the same rollback, plus the human half the brief
        // requires: a plain-English notice, and back to /courses rather than left
        // sitting on /course/{code} for a course that was never actually saved.
        setLearnerState(vars.previousState)
        router.push('/courses')
        toast.error(messageOf(error))
        throw error
      } finally {
        // Cleared only if nothing newer has already claimed this code's slot —
        // a stale `finally` must never clear a more recent tap's in-flight marker.
        if (pendingCodeRef.current === vars.code) pendingCodeRef.current = null
      }
    },
  }))

  function selectCourse(code: CourseCode) {
    if (!learnerState) return
    // A double tap on the *same* card while it is still in flight must not fire a
    // second plan-refresh call; a tap on a *different* card is allowed through —
    // the token below (checked inside `switchCourse`) makes the last one tapped
    // win the write no matter which round trip returns first. This guard reads a
    // ref set synchronously at tap time (cleared in `mutate`'s `finally`), not
    // `mutation.isPending` — that flag only updates on React's next render, which
    // is not guaranteed to have happened yet for two clicks in the same tick.
    if (pendingCodeRef.current === code) return
    pendingCodeRef.current = code
    const token = ++switchTokenRef.current

    const plan = provisionalPlan({ code, clos: closFor(code), exercises: loadedBundle(code)?.exercises ?? [], mastery: learnerState.mastery })
    // Store half of the optimistic patch, synchronously: the destination
    // (/course/{code}, the dashboard, De-rot, the Buddy) all read learner state
    // from this store, not from `qk.learnerState` — only /courses itself reads
    // the query cache. Navigation itself is the `<Link>` this handler is wired
    // to (wave-1 review I1): only a real `<Link>` gets prefetched on this or any
    // route, and its own click handler runs its router transition right after
    // this one returns — so the whole optimistic switch is under way before
    // the destination route paints.
    setLearnerState(withCoursePlan(learnerState, code, plan))
    mutation.mutate({ code, plan, token, previousState: learnerState })
  }

  const chipVisible = mutation.isPending && !chipDismissed

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-medium tracking-tight">Courses</h1>
        <p className="mt-2 text-sm text-muted-foreground">Switch anytime. Progress in every course is kept.</p>
      </div>

      {chipVisible && (
        <div role="status" className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-input px-4 py-2 text-sm text-muted-foreground">
          <span>Tuning your path.</span>
          <button
            type="button"
            onClick={() => setChipDismissed(true)}
            className="shrink-0 rounded-sm text-xs underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Dismiss
          </button>
        </div>
      )}

      <div role="group" aria-label="Live courses" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {courses.map((course, index) => (
          <CourseCard
            key={course.code}
            status="live"
            code={course.code}
            title={course.title}
            language={course.language}
            level={course.level}
            progress={learnerState ? courseProgress(course.code, learnerState.mastery) : 0}
            isCurrent={learnerState?.currentCourse === course.code}
            hasPath={learnerState?.currentCourse === course.code && learnerState.path.length > 0}
            index={index}
            reducedMotion={reducedMotion}
            onSelect={selectCourse}
          />
        ))}
      </div>

      {comingSoon.length > 0 && (
        <div className="space-y-3 border-t border-border pt-6">
          <h2 className="text-xs font-medium text-muted-foreground">Coming soon</h2>
          <div role="group" aria-label="Coming soon" className="grid gap-3 sm:grid-cols-3">
            {comingSoon.map((course, index) => (
              <CourseCard
                key={course.slug}
                status="coming-soon"
                title={course.title}
                language={course.language}
                reason={COMING_SOON_REASON}
                index={courses.length + index}
                reducedMotion={reducedMotion}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
