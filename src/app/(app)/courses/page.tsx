'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { CourseCode, LearnerState } from '@/lib/contracts'
import { closFor, liveCourses, loadCourseBundle, loadedBundle } from '@/lib/curriculum'
import { provisionalPlan } from '@/lib/learner/provisional'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'
import { qk } from '@/lib/query/keys'
import { useLearnerState } from '@/lib/query/hooks'
import { useOptimistic } from '@/lib/query/optimistic'
import { createClient } from '@/lib/supabase/client'
import { useSession } from '@/store/session'
import { CourseCard } from '@/components/course/CourseCard'
import { courseProgress, switchCourse } from './lib'
import comingSoonSeed from '../../../../seed/courses.json'

type ComingSoonCourse = { slug: string; title: string; language: string }
const COMING_SOON: ComingSoonCourse[] = comingSoonSeed.coming_soon
const COMING_SOON_REASON = 'Not open yet. More courses are on the way.'

export default function CoursesPage() {
  const router = useRouter()
  const userId = useSession((session) => session.user?.id ?? null)
  const reducedMotion = useReducedMotion()
  const learnerStateQuery = useLearnerState()
  const learnerState = learnerStateQuery.data ?? null
  const [chipDismissed, setChipDismissed] = useState(false)

  const courses = useMemo(() => liveCourses(), [])

  useEffect(() => {
    // Best-effort warmth only (spec 4.3 step 2: "data already in the bundle").
    // Nothing downstream depends on this finishing before a tap — a tap that
    // lands before a bundle loads just gets a thinner provisional plan.
    for (const course of courses) void loadCourseBundle(course.code)
  }, [courses])

  const mutation = useMutation(useOptimistic<LearnerState | undefined, CourseCode>({
    key: qk.learnerState(userId ?? ''),
    apply: (previous, code) => {
      if (!previous) return previous
      // `closFor` is a zero-network, build-time read — always available. The
      // bundle's exercises are best-effort: usually already warm from the
      // prefetch above, but a tap that lands before it resolves still gets a
      // full path, just a thinner (or empty) Next-up stack until the
      // background write in `mutate` reconciles it.
      const plan = provisionalPlan({ code, clos: closFor(code), exercises: loadedBundle(code)?.exercises ?? [], mastery: previous.mastery })
      return { ...previous, currentCourse: code, path: plan.path, nextExerciseIds: plan.nextExerciseIds }
    },
    mutate: async (code) => {
      if (!userId || !learnerState) return
      const client = createClient()
      const { pathTuned } = await switchCourse({ client, userId, code, fallback: learnerState })
      if (pathTuned) toast('Path tuned.')
    },
  }))

  function selectCourse(code: CourseCode) {
    // Step 1 of the switch (spec 4.3 R4.4): optimistic navigation, in the same
    // frame, before the mutation below has done anything at all.
    router.push(`/course/${code}`)
    mutation.mutate(code)
  }

  const chipVisible = mutation.isPending && !chipDismissed

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-medium tracking-tight">Your courses</h1>
        <p className="mt-2 text-sm text-muted-foreground">Switch anytime. Your progress in every course is kept.</p>
      </div>

      {chipVisible && (
        <div role="status" className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-input px-4 py-2 text-sm text-muted-foreground">
          <span>Tuning your path.</span>
          <button
            type="button"
            onClick={() => setChipDismissed(true)}
            className="shrink-0 rounded-sm text-xs underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
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

      {COMING_SOON.length > 0 && (
        <div className="space-y-3 border-t border-border pt-6">
          <h2 className="text-xs font-medium text-muted-foreground">Coming soon</h2>
          <div role="group" aria-label="Coming soon" className="grid gap-3 sm:grid-cols-3">
            {COMING_SOON.map((course, index) => (
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
