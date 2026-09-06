import type { Clo, CloId, CourseCode, ExercisePublic, LearnerState } from '@/lib/contracts'
import { DEFAULT_DIFFICULTY, pickFromBank } from './bank'

export interface ProvisionalPlanArgs {
  code: CourseCode
  clos: readonly Clo[]
  exercises: readonly ExercisePublic[]
  mastery: LearnerState['mastery']
}

export interface ProvisionalPlan {
  path: CloId[]
  nextExerciseIds: string[]
}

/** How many distinct-pattern candidates the Next-up stack shows (spec 4.3 step 2). */
const NEXT_UP_COUNT = 3

/**
 * Depth-first topological sort on `Clo.prerequisites`, starting from the
 * course's own ordinal order so ties (and courses with no prerequisites at
 * all) come back exactly as-authored. Two corrections from §10.4:
 *  - a prerequisite id that is not one of THIS course's own CLOs (e.g.
 *    INFS1201-1 lists INFS1101-4, a different course) is a dangling
 *    external id, not an unresolved dependency — it is ignored rather than
 *    walked or counted toward a cycle.
 *  - if the in-course prerequisites still contain a genuine cycle, sorting
 *    is abandoned entirely and the ordinal order is returned as-is.
 */
function topologicalOrder(clos: readonly Clo[]): Clo[] {
  const ordinalOrder = [...clos].sort((a, b) => a.ordinal - b.ordinal)
  const inCourseIds = new Set(ordinalOrder.map((clo) => clo.id))
  const byId = new Map(ordinalOrder.map((clo) => [clo.id, clo]))

  const visited = new Set<CloId>()
  const visiting = new Set<CloId>()
  const order: Clo[] = []
  let cycle = false

  function visit(clo: Clo): void {
    if (cycle || visited.has(clo.id)) return
    if (visiting.has(clo.id)) {
      cycle = true
      return
    }
    visiting.add(clo.id)
    for (const prerequisiteId of clo.prerequisites) {
      if (!inCourseIds.has(prerequisiteId)) continue // dangling external id — ignored, not a cycle
      const prerequisite = byId.get(prerequisiteId)
      if (prerequisite) visit(prerequisite)
      if (cycle) return
    }
    visiting.delete(clo.id)
    visited.add(clo.id)
    order.push(clo)
  }

  for (const clo of ordinalOrder) {
    visit(clo)
    if (cycle) break
  }

  return cycle ? ordinalOrder : order
}

/**
 * Widens `pickFromBank` across three calls, excluding each pick's id and
 * pattern from the next so the three results are guaranteed distinct
 * patterns (or fewer, if the CLO's bank genuinely does not have three).
 */
function pickDistinctPatterns(cloId: CloId, exercises: readonly ExercisePublic[]): string[] {
  const rows = exercises.filter((exercise) => exercise.cloId === cloId)
  const excludeExerciseIds: string[] = []
  const excludePatterns: string[] = []
  const ids: string[] = []

  for (let i = 0; i < NEXT_UP_COUNT; i++) {
    const pick = pickFromBank({ cloId, difficulty: DEFAULT_DIFFICULTY, excludeExerciseIds, excludePatterns }, rows)
    if (!pick) break
    ids.push(pick.id)
    excludeExerciseIds.push(pick.id)
    excludePatterns.push(pick.pattern)
  }

  return ids
}

/**
 * The provisional plan a course switch renders instantly, before the
 * Planner is ever asked (spec 4.3 R4.4 step 2): the course's CLOs in
 * prerequisite-respecting order, and three distinct-pattern exercises for
 * the first CLO that is not yet closed. Pure, synchronous, zero network —
 * every input is data the client already holds.
 */
export function provisionalPlan(args: ProvisionalPlanArgs): ProvisionalPlan {
  const { code, clos, exercises, mastery } = args
  const courseClos = clos.filter((clo) => clo.course === code)
  const sorted = topologicalOrder(courseClos)
  const path = sorted.map((clo) => clo.id)

  const target = path.find((cloId) => !mastery[cloId]?.closed) ?? path[path.length - 1]
  const nextExerciseIds = target ? pickDistinctPatterns(target, exercises) : []

  return { path, nextExerciseIds }
}
