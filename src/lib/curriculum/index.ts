import type { Clo, CloId, Course, CourseCode, ExercisePublic, LessonPublic, PatternId } from '../contracts'
import { BUILD_ID, CLOS, COURSE_HASHES, COURSES, PATTERNS } from './generated'

export { BUILD_ID }

export interface CourseBundle {
  code: CourseCode
  clos: Clo[]
  exercises: ExercisePublic[]
  lessons: LessonPublic[]
}

/** Live and coming-soon courses, ordered by level then code. Zero network — bundled at build (R5.1). */
export function courses(): readonly Course[] {
  return COURSES
}

export function liveCourses(): readonly Course[] {
  return COURSES.filter((c) => c.status === 'live')
}

export function course(code: CourseCode): Course | null {
  return COURSES.find((c) => c.code === code) ?? null
}

/** CLOs for one course, in ordinal order (generated.ts is already sorted course-then-ordinal). */
export function closFor(code: CourseCode): readonly Clo[] {
  return CLOS.filter((c) => c.course === code)
}

export function clo(id: CloId): Clo | null {
  return CLOS.find((c) => c.id === id) ?? null
}

const PATTERN_NAMES = new Map(PATTERNS.map((p) => [p.id, p.name]))

export function patternName(id: PatternId): string {
  return PATTERN_NAMES.get(id) ?? id
}

/**
 * Thrown by loadCourseBundle on any failure. Screens render this through
 * <ErrorRetry>; there is no silent fallback to a Supabase read (R5.1) —
 * that would hide exactly the slow path this bundle exists to remove.
 */
export class CurriculumLoadError extends Error {
  readonly code: CourseCode

  constructor(code: CourseCode, cause: unknown) {
    super(`failed to load curriculum bundle for ${code}`)
    this.name = 'CurriculumLoadError'
    this.code = code
    this.cause = cause
  }
}

type CourseBundlePayload = Omit<CourseBundle, 'code'>

const bundleRequests = new Map<CourseCode, Promise<CourseBundle>>()
const loadedBundles = new Map<CourseCode, CourseBundle>()

/**
 * Fetched once per session per course, memoised in this module-level Map so
 * two components mounting in the same frame share one request. `force-cache`
 * plus the `?v=<hash>` query means a redeploy is the only thing that
 * invalidates it — matching the `staleTime: Infinity` / `gcTime: Infinity`
 * curriculum query in spec 5.2.
 */
export function loadCourseBundle(code: CourseCode): Promise<CourseBundle> {
  const existing = bundleRequests.get(code)
  if (existing) return existing

  const version = COURSE_HASHES[code] ?? 'dev'
  const request = fetch(`/curriculum/course/${code}.json?v=${version}`, { cache: 'force-cache' })
    .then((res) => {
      if (!res.ok) throw new Error(`curriculum bundle ${code} responded ${res.status}`)
      return res.json() as Promise<CourseBundlePayload>
    })
    .then((payload) => {
      const bundle: CourseBundle = { code, ...payload }
      loadedBundles.set(code, bundle)
      return bundle
    })
    .catch((error) => {
      // A rejected fetch must not poison the cache for a later retry.
      bundleRequests.delete(code)
      throw error instanceof CurriculumLoadError ? error : new CurriculumLoadError(code, error)
    })

  bundleRequests.set(code, request)
  return request
}

/** Synchronous read of an already-loaded bundle; null if not loaded yet. */
export function loadedBundle(code: CourseCode): CourseBundle | null {
  return loadedBundles.get(code) ?? null
}

export function lessonFor(code: CourseCode, cloId: CloId): LessonPublic | null {
  return loadedBundle(code)?.lessons.find((lesson) => lesson.cloId === cloId) ?? null
}

/**
 * Null means the id is not in the static bundle — the runtime-generated case
 * (`origin: 'generated'`) that is never shipped in a shared static file and
 * must fall through to a single `exercises_public` read instead (R5.1b).
 */
export function exerciseFrom(code: CourseCode, id: string): ExercisePublic | null {
  return loadedBundle(code)?.exercises.find((exercise) => exercise.id === id) ?? null
}
