import { LessonSkeleton } from '@/components/lesson/LessonSkeleton'

/** The shape of the page -- rail, hook, concept block, code block -- rather
 *  than a spinner (spec 10.5). This file's mere existence is also what turns
 *  on router prefetching for this dynamic route: a `[cloId]` segment with no
 *  `loading.js` is not prefetched by `<Link>` at all. */
export default function LessonLoading() {
  return <LessonSkeleton />
}
