'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { CloId, CourseCode, LessonProgress, LessonPublic } from '@/lib/contracts'
import { clo, course as findCourse, lessonFor, loadCourseBundle } from '@/lib/curriculum'
import { nextProgress, isStale, type LessonEvent } from '@/lib/lesson/progress'
import { useLessonProgress, useWellness } from '@/lib/query/hooks'
import { optimistic } from '@/lib/query/optimistic'
import { qk } from '@/lib/query/keys'
import { resolveWellnessPrefs } from '@/lib/wellness/prefs'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'
import { play } from '@/lib/sound/manager'
import { useSession } from '@/store/session'
import { clearQueuedProgress, persistLessonProgressRow, queueProgress, readQueuedProgress } from './progressSync'
import { RevealBlock } from './RevealBlock'
import { ProgressRail } from './ProgressRail'
import { SkipButton } from './SkipButton'
import { ConceptBlock } from './ConceptBlock'
import { SnippetBlock } from './SnippetBlock'
import { WorkedBlock } from './WorkedBlock'
import { CheckBlock } from './CheckBlock'
import { RecapBlock } from './RecapBlock'
import { BridgeBlock } from './BridgeBlock'
import { ErrorRetry } from './ErrorRetry'
import { LessonSkeleton } from './LessonSkeleton'

/** The one-time shake keyframe `CheckBlock` opts into on a wrong answer
 *  (R7.9: never under reduced motion). A plain `<style>` element rather than
 *  a `globals.css` edit -- this task does not own that file. */
const SHAKE_STYLE = '@keyframes lesson-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}.lesson-shake{animation:lesson-shake 150ms ease-in-out}'

/**
 * The lesson-level reducer: local render state is the single source of truth
 * for what the learner sees, and is never rolled back by a failed
 * persistence attempt (the query cache that `optimistic()` mutates is a
 * separate, best-effort sync channel other consumers read from -- rolling
 * that back on a failed write is correct for THEM, and invisible to this
 * screen).
 */
function useLessonRunner(cloId: CloId) {
  const session = useSession()
  const userId = session.user?.id ?? null
  const cloRecord = clo(cloId)
  const course: CourseCode | null = cloRecord?.course ?? null

  const bundleQuery = useQuery({
    queryKey: qk.curriculum(course ?? ''),
    queryFn: () => loadCourseBundle(course as CourseCode),
    enabled: course !== null,
    staleTime: Infinity,
    gcTime: Infinity,
  })

  const lesson: LessonPublic | null = course && bundleQuery.data ? lessonFor(course, cloId) : null

  // Wave 1 gate fix (C1): a DSAI2201 lesson's runnable snippet or micro-code
  // check needs the same Pyodide packages (numpy, pandas, ...) the exercise
  // screen loads for that course, or the run throws ModuleNotFoundError.
  // `LessonSnippet`/the check kinds carry no per-exercise packages field
  // (checked `src/lib/contracts.ts` -- Exercise/ExercisePublic has none
  // either), so "the union across the course's exercises" is, concretely,
  // the one list already sitting on `Course.packages` in the static
  // curriculum bundle (`course(code)`, synchronous, zero network -- the same
  // data `useExerciseLoop.ts` fetches from `courses.packages` over Supabase
  // for the identical purpose). Computed once per lesson, here, and handed
  // down to every snippet and check rather than each one re-deriving it.
  const packages = course ? (findCourse(course)?.packages ?? []) : []

  const progressQuery = useLessonProgress()
  const prevRow = progressQuery.data?.find((row) => row.lessonId === cloId) ?? null

  // One state object, not two: `staleNotice` is only knowable at the exact
  // moment the 'opened' event folds a possibly-stale `seed` into `progress`,
  // and reading a ref during render (to surface it) or calling a second,
  // conditional setState in the same effect are both rejected by the
  // React Compiler lint (`react-hooks/refs`, `react-hooks/set-state-in-effect`).
  // Setting both together, unconditionally, in the one `setState` call below
  // sidesteps both rules exactly the way `setProgress(next)` alone already did.
  const [state, setState] = useState<{ progress: LessonProgress; staleNotice: boolean } | null>(null)
  const openedFor = useRef<string | null>(null)
  // Fix round 1 (M4, surfaced by I1): React runs child effects before parent
  // effects. Under reduced motion every `RevealBlock` fires `onReveal` on its
  // own first-mount effect, all of which run before this component's own
  // 'opened' effect below -- so `advanceBlock`'s `dispatch` would silently
  // no-op (`state` is still null) for every block revealed in that first
  // commit. Buffering the furthest index here, independent of `state`, means
  // the 'opened' effect can fold it into the very first progress it computes
  // instead of losing it.
  const furthestRevealed = useRef(0)

  const mutation = useMutation(optimistic<LessonProgress[], LessonProgress>({
    key: qk.lessonProgress(userId ?? ''),
    apply: (previous, row) => [...(previous ?? []).filter((item) => item.lessonId !== row.lessonId), row],
    mutate: async (row) => {
      if (!userId) return
      try {
        await persistLessonProgressRow(row)
        clearQueuedProgress(userId, row.lessonId)
      } catch (error) {
        // Queued for the next mount (0006 is not applied in production yet) --
        // never thrown away, and never allowed to touch the local `progress`
        // state this screen actually renders from.
        queueProgress(userId, row)
        throw error
      }
    },
  }))

  useEffect(() => {
    if (!lesson || !userId) return
    if (progressQuery.isPending) return
    if (openedFor.current === lesson.id) return
    openedFor.current = lesson.id
    const queued = readQueuedProgress(userId, lesson.id)
    const seed = queued ?? prevRow
    const staleNotice = Boolean(seed && isStale(seed, lesson))
    const opened = nextProgress(seed, { type: 'opened', lesson, userId }, new Date().toISOString())
    // Fold in any reveal(s) that already fired this same commit (M4 above).
    const next = furthestRevealed.current > opened.blockIndex
      ? { ...opened, blockIndex: furthestRevealed.current }
      : opened
    setState({ progress: next, staleNotice })
    mutation.mutate(next)
    // mutation is a stable useMutation result; re-running this on every
    // render would re-open the lesson on each keystroke elsewhere on the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson, userId, progressQuery.isPending, prevRow])

  const progress = state?.progress ?? null

  function dispatch(event: LessonEvent) {
    if (!state) return
    const next = nextProgress(state.progress, event, new Date().toISOString())
    setState({ ...state, progress: next })
    mutation.mutate(next)
  }

  function advanceBlock(index: number) {
    if (index <= furthestRevealed.current) return
    furthestRevealed.current = index
    // Before the lesson has finished opening, there is nothing to dispatch
    // against yet -- the buffered value above is picked up by the 'opened'
    // effect itself once it runs (M4).
    if (!state) return
    if (index <= state.progress.blockIndex) return
    dispatch({ type: 'block-advanced', index })
  }

  function answerCheck(right: boolean) {
    dispatch({ type: 'check', right })
  }

  function skip() {
    dispatch({ type: 'skipped' })
  }

  function complete() {
    dispatch({ type: 'completed' })
    play('pass', { volumeScale: 0.7 })
  }

  return {
    course, lesson, bundleQuery, progress, staleNotice: state?.staleNotice ?? false, packages,
    skip, complete, advanceBlock, answerCheck,
  }
}

export function LessonView({ cloId }: { cloId: CloId }) {
  const wellnessQuery = useWellness()
  const prefs = resolveWellnessPrefs(wellnessQuery.data?.prefs)
  const reducedMotion = useReducedMotion(prefs.motion)
  const runner = useLessonRunner(cloId)
  const { course, lesson, bundleQuery, progress, staleNotice, packages, skip, complete, advanceBlock, answerCheck } = runner

  if (!clo(cloId)) {
    return (
      <section className="mx-auto max-w-xl space-y-4 py-12">
        <h1 className="text-2xl font-medium tracking-tight">This walkthrough could not open</h1>
        <p className="text-sm text-muted-foreground">That skill was not found. Choose a course to keep going.</p>
        <Link href="/courses" className="text-sm font-medium text-primary underline-offset-4 hover:underline">Back to courses</Link>
      </section>
    )
  }

  if (bundleQuery.isError) {
    return (
      <div className="mx-auto max-w-xl py-12">
        <ErrorRetry
          message="This lesson could not load."
          onRetry={() => void bundleQuery.refetch()}
          secondaryHref="/courses"
          secondaryLabel="Back to courses"
        />
      </div>
    )
  }

  if (!lesson) {
    if (bundleQuery.isPending || !bundleQuery.data) return <LessonSkeleton />
    return (
      <section className="mx-auto max-w-xl space-y-4 py-12">
        <h1 className="text-2xl font-medium tracking-tight">This walkthrough isn&apos;t ready yet</h1>
        <p className="text-sm text-muted-foreground">There is no walkthrough for this skill yet. Practice reps are still open.</p>
        <Link href={course ? `/course/${course}` : '/courses'} className="text-sm font-medium text-primary underline-offset-4 hover:underline">Back to your path</Link>
      </section>
    )
  }

  const total = lesson.blocks.length
  const currentBlockIndex = progress?.blockIndex ?? 0
  const completed = progress?.status === 'completed'
  const skipped = progress?.status === 'skipped'

  return (
    <div className="mx-auto flex max-w-3xl gap-6 py-10">
      <style>{SHAKE_STYLE}</style>
      <ProgressRail total={total} current={currentBlockIndex} />
      <div className="min-w-0 max-w-[45rem] flex-1 space-y-6">
        <div className="flex items-center justify-between gap-3">
          <Link href={course ? `/course/${course}` : '/courses'} className="inline-flex items-center gap-1.5 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            <ArrowLeft className="size-3" aria-hidden="true" />Path map
          </Link>
          <SkipButton onSkip={skip} disabled={skipped} />
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-medium tracking-tight">{lesson.title}</h1>
            {lesson.draft && <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">Draft</span>}
          </div>
          <p className="text-base text-muted-foreground">{lesson.hook}</p>
        </div>

        {staleNotice && (
          <p role="status" className="rounded-lg border border-dashed border-input p-3 text-xs text-muted-foreground">
            This walkthrough was updated since you last opened it.
          </p>
        )}
        {skipped && (
          <p role="status" className="rounded-lg border border-dashed border-input p-3 text-xs text-muted-foreground">
            Marked as skipped. You can still read through if you want.
          </p>
        )}

        {lesson.blocks.map((block, index) => (
          <RevealBlock key={block.id} reduced={reducedMotion} onReveal={() => advanceBlock(index)}>
            {block.type === 'concept' && <ConceptBlock block={block} />}
            {block.type === 'snippet' && <SnippetBlock block={block} packages={packages} />}
            {block.type === 'worked' && <WorkedBlock block={block} reduced={reducedMotion} />}
            {block.type === 'check' && <CheckBlock block={block} reduced={reducedMotion} onAnswered={answerCheck} packages={packages} />}
            {block.type === 'recap' && <RecapBlock block={block} />}
            {block.type === 'bridge' && <BridgeBlock block={block} course={course ?? ''} completed={completed} onComplete={complete} />}
          </RevealBlock>
        ))}
      </div>
    </div>
  )
}
