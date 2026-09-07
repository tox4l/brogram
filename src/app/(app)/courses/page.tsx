/**
 * V7: no `'use client'` here. This file's import of `seed/courses.json` --
 * and the internal authoring note that lives elsewhere in that same JSON, on
 * a live course entry (`INFS1201.note`) -- stays on the server; only the
 * plain `comingSoon` array serialized below crosses into `CoursesClient`'s
 * client module graph. Nothing here renders `course.note`, and nothing here
 * ships it either.
 */
import { CoursesClient, type ComingSoonCourse } from './CoursesClient'
import comingSoonSeed from '../../../../seed/courses.json'

const COMING_SOON: readonly ComingSoonCourse[] = comingSoonSeed.coming_soon

export default function CoursesPage() {
  return <CoursesClient comingSoon={COMING_SOON} />
}
