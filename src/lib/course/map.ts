/**
 * Pure derivations for the course home path map (spec §3.5, R3.8). Every node
 * state, the current CLO, and the Next-up stack are computed from data that
 * already exists in the static curriculum bundle and `LearnerState` -- zero
 * new fields, zero network calls. See `docs/superpowers/specs/2026-09-06-brogram-v2-bro.md`
 * §3.5 and §10.4.
 */

import type { Clo, CloId, CourseCode, Difficulty, ExercisePublic, Language, LearnerState, LessonProgress, LessonPublic } from '@/lib/contracts'
import { DEFAULT_DIFFICULTY, pickFromBank } from '@/lib/learner/bank'

/** A skill closes at three passes, three distinct patterns (Mastery.chain). */
const CHAIN_TARGET = 3
/** Guards the local bank-widening fill loop below against ever looping unboundedly. */
const MAX_FILL_ATTEMPTS = 20
/** Distinct-pattern candidates the stack fills locally (spec §4.3 step 2, matching `provisionalPlan`). */
const NEXT_UP_COUNT = 3

/** One source of truth for "does a lesson exist for this skill", shared by
 *  `buildMap` and `nextUp` -- only the golden lesson exists until T1.1's
 *  batch lands, and both derivations must agree on which CLOs have one. */
function lessonCloIds(lessons: readonly LessonPublic[]): Set<CloId> {
  return new Set(lessons.map((lesson) => lesson.cloId))
}

export type NodeState = 'locked' | 'available' | 'walkthrough-ready' | 'in-progress' | 'locked-in'

export interface MapNode {
  cloId: CloId
  title: string
  ordinal: number
  state: NodeState
  chain: number
  closed: boolean
  draft: boolean
  /** True when "I've got this" was used on this skill's walkthrough (R3.3). */
  skipped: boolean
  /** False when no lesson exists yet for this skill in the static bundle --
   *  the node's primary action is its first bank exercise instead (see
   *  `nodeHref`), never a dead link into empty content. */
  lessonAvailable: boolean
  /** In-course prerequisites only. Out-of-course ones are advisory and never gate. */
  prerequisites: CloId[]
  /** Drawn faint, labelled "comes from another course", never gating. */
  externalPrerequisites: CloId[]
}

/**
 * Every node state is a pure derivation of data that already exists.
 *
 * Three corrections this function encodes, all of which would otherwise have
 * shipped as bugs (spec §3.5 critic):
 *  1. `Clo.draft` is a real field -- read it, never a parallel row type.
 *  2. `unseen` is not a `lesson_progress` status; it is the absence of a row,
 *     and the derivation below says so (an empty or missing `lessonProgress`
 *     array reads exactly the same as "no row yet" -- so a table that has not
 *     been migrated in production degrades to "no progress yet", never a crash).
 *  3. Locked ignores cross-course prerequisites. `Clo.prerequisites` crosses
 *     course boundaries in the shipped seed; a prerequisite CLO that is not
 *     part of THIS course is advisory only and never gates a node.
 *
 * A fourth correction from the fix round: `walkthrough-ready` additionally
 * requires a lesson to actually exist for the CLO (`lessonCloIds`) -- a CLO
 * with no lesson yet reads as plain `available`, never claims a walkthrough,
 * and `nodeHref` below sends its node to a live bank exercise instead.
 */
export function buildMap(args: {
  clos: readonly Clo[]
  code: CourseCode
  mastery: LearnerState['mastery']
  lessonProgress: readonly LessonProgress[]
  lessons: readonly LessonPublic[]
  /** `LearnerState.path`: nodes render in this order (spec §3.5, §10.4 --
   *  "laid out along `LearnerState.path` order", "Tab moves through the
   *  nodes in path order"). A CLO missing from `path` (a stale saved path,
   *  or a course being viewed before any plan exists for it) is appended in
   *  ordinal order rather than hidden. */
  path: readonly CloId[]
}): MapNode[] {
  const { code, mastery, lessonProgress, lessons, path } = args
  const courseClos = args.clos.filter((clo) => clo.course === code)
  const inCourseIds = new Set(courseClos.map((clo) => clo.id))
  const lessonIds = lessonCloIds(lessons)

  const byId = new Map(courseClos.map((clo) => [clo.id, clo]))
  const seen = new Set<CloId>()
  const orderedClos: Clo[] = []
  for (const id of path) {
    const clo = byId.get(id)
    if (clo && !seen.has(id)) {
      orderedClos.push(clo)
      seen.add(id)
    }
  }
  for (const clo of [...courseClos].sort((a, b) => a.ordinal - b.ordinal)) {
    if (!seen.has(clo.id)) orderedClos.push(clo)
  }

  return orderedClos.map((clo) => {
    const prerequisites = clo.prerequisites.filter((id) => inCourseIds.has(id))
    const externalPrerequisites = clo.prerequisites.filter((id) => !inCourseIds.has(id))
    const cloMastery = mastery[clo.id]
    const closed = cloMastery?.closed ?? false
    const chain = cloMastery?.chain ?? 0
    const prerequisitesClosed = prerequisites.every((id) => mastery[id]?.closed ?? false)
    const progress = lessonProgress.find((row) => row.cloId === clo.id)
    const lessonAvailable = lessonIds.has(clo.id)

    let state: NodeState
    if (!prerequisitesClosed) {
      state = 'locked'
    } else if (closed) {
      state = 'locked-in'
    } else if (chain > 0) {
      state = 'in-progress'
    } else {
      // Correction 2: "unseen" is not a status -- it is the absence of a row.
      // Correction 4: no lesson, no walkthrough claim -- plain `available`.
      const walkthroughReady = lessonAvailable && (!progress || progress.status === 'started')
      state = walkthroughReady ? 'walkthrough-ready' : 'available'
    }

    return {
      cloId: clo.id,
      title: clo.outcome,
      ordinal: clo.ordinal,
      state,
      chain,
      closed,
      draft: clo.draft ?? false,
      skipped: progress?.status === 'skipped',
      lessonAvailable,
      prerequisites,
      externalPrerequisites,
    }
  })
}

/** First CLO in path order whose mastery is not closed; the last one when all are closed. */
export function currentCloId(path: readonly CloId[], mastery: LearnerState['mastery']): CloId | null {
  if (path.length === 0) return null
  const firstOpen = path.find((id) => !(mastery[id]?.closed ?? false))
  return firstOpen ?? path[path.length - 1]
}

function stateLabel(node: Pick<MapNode, 'state' | 'chain'>): string {
  switch (node.state) {
    case 'locked':
      return 'locked'
    case 'available':
      return 'available'
    case 'walkthrough-ready':
      return 'available, walkthrough ready'
    case 'in-progress':
      return `in progress, ${node.chain} of ${CHAIN_TARGET}`
    case 'locked-in':
      return 'locked in'
  }
}

/**
 * The map's whole keyboard/screen-reader story rests on this one accessible
 * name per node (spec §10.4 critic): "the skill plus its state plus its
 * progress" -- e.g. "Loops that stop when you tell them to -- in progress, 2
 * of 3". Node state is never carried by colour alone; this is the text
 * channel every other cue (shape, token, glyph) backs up.
 */
export function nodeAccessibleName(node: Pick<MapNode, 'title' | 'state' | 'chain' | 'draft' | 'skipped'>): string {
  let name = `${node.title} — ${stateLabel(node)}`
  if (node.draft) name += ', drafted'
  if (node.skipped) name += ', walkthrough skipped'
  return name
}

/**
 * Every node's primary action: the walkthrough when a lesson exists for its
 * skill, otherwise the CLO's first bank exercise -- so a lesson-less skill
 * (every skill but one, until T1.1's batch lands) never dead-ends into
 * `LessonView`'s "not ready yet" fallback with no way to reach a rep. Every
 * live course carries at least one bank exercise per CLO by launch, so the
 * lesson route is a last-resort fallback only, never the common case.
 */
export function nodeHref(node: Pick<MapNode, 'cloId' | 'lessonAvailable'>, exercises: readonly ExercisePublic[]): string {
  if (node.lessonAvailable) return `/lesson/${encodeURIComponent(node.cloId)}`
  const firstRep = exercises.find((exercise) => exercise.cloId === node.cloId)
  return firstRep ? `/exercise/${encodeURIComponent(firstRep.id)}` : `/lesson/${encodeURIComponent(node.cloId)}`
}

export type NextUpCardKind = 'walkthrough' | 'exercise'

export interface NextUpCard {
  kind: NextUpCardKind
  /** cloId for a walkthrough card, exerciseId for an exercise card. */
  id: string
  cloId: CloId
  title: string
  href: string
  language?: Language
  difficulty?: Difficulty
  /** "After the walkthrough, or skip it." -- shown on cards 2 and 3 when a walkthrough leads. */
  caption?: string
  /** True when the bank widened locally to keep the stack at exactly three. */
  pickedForYou?: boolean
}

/**
 * Widens `pickFromBank` across up to three calls, excluding each pick's id
 * and pattern from the next so the fill is guaranteed distinct patterns (or
 * fewer, if the CLO's bank genuinely does not have that many) -- the same
 * rule `provisionalPlan`'s `pickDistinctPatterns` applies, so a fresh
 * account gets the same answer on `/courses` and on this screen.
 */
function fillDistinctPatterns(cloId: CloId, exercises: readonly ExercisePublic[], alreadyUsed: ReadonlySet<string>): ExercisePublic[] {
  const excludeExerciseIds = [...alreadyUsed]
  const excludePatterns: string[] = []
  const picked: ExercisePublic[] = []

  for (let attempt = 0; picked.length < NEXT_UP_COUNT && attempt < MAX_FILL_ATTEMPTS; attempt += 1) {
    const pick = pickFromBank({ cloId, difficulty: DEFAULT_DIFFICULTY, excludeExerciseIds, excludePatterns }, exercises as ExercisePublic[])
    if (!pick) break
    picked.push(pick)
    excludeExerciseIds.push(pick.id)
    excludePatterns.push(pick.pattern)
  }

  return picked
}

/**
 * R3.8: the Next-up stack is always exactly three cards.
 *  - If the current CLO has a lesson and either no `lesson_progress` row, or
 *    one with `status: 'started'`: card 1 is the walkthrough, cards 2 and 3
 *    are the Planner's first two `nextExerciseIds`, at full opacity,
 *    captioned. A CLO with no lesson at all never gets a walkthrough card --
 *    the fix-round correction: three live exercise cards instead of a dead
 *    placeholder burning a seat.
 *  - Otherwise the three cards are `nextExerciseIds` in Planner order.
 *  - Short lists are filled from the bank, locally, with distinct patterns
 *    -- never an empty slot, never a wait on an agent.
 */
export function nextUp(args: {
  currentCloId: CloId | null
  clos: readonly Clo[]
  lessons: readonly LessonPublic[]
  lessonProgress: readonly LessonProgress[]
  nextExerciseIds: readonly string[]
  exercises: readonly ExercisePublic[]
}): NextUpCard[] {
  const { clos, lessons, lessonProgress, nextExerciseIds, exercises } = args
  const currentClo = args.currentCloId ? (clos.find((clo) => clo.id === args.currentCloId) ?? null) : null
  const progress = currentClo ? lessonProgress.find((row) => row.cloId === currentClo.id) : undefined
  const hasLesson = currentClo ? lessonCloIds(lessons).has(currentClo.id) : false
  const walkthroughDue = currentClo !== null && hasLesson && (!progress || progress.status === 'started')

  const cards: NextUpCard[] = []
  const used = new Set<string>()

  function addExercise(exercise: ExercisePublic, extra: Partial<NextUpCard> = {}): boolean {
    if (used.has(exercise.id)) return false
    used.add(exercise.id)
    cards.push({
      kind: 'exercise',
      id: exercise.id,
      cloId: exercise.cloId,
      title: exercise.title,
      href: `/exercise/${encodeURIComponent(exercise.id)}`,
      language: exercise.language,
      difficulty: exercise.difficulty,
      ...extra,
    })
    return true
  }

  function addExerciseById(id: string, extra: Partial<NextUpCard> = {}): boolean {
    const exercise = exercises.find((row) => row.id === id)
    return exercise ? addExercise(exercise, extra) : false
  }

  if (walkthroughDue && currentClo) {
    const lesson = lessons.find((row) => row.cloId === currentClo.id)
    cards.push({
      kind: 'walkthrough',
      id: currentClo.id,
      cloId: currentClo.id,
      title: lesson!.title,
      href: `/lesson/${encodeURIComponent(currentClo.id)}`,
    })
    for (const id of nextExerciseIds) {
      if (cards.length >= 3) break
      addExerciseById(id, { caption: 'After the walkthrough, or skip it.' })
    }
  } else {
    for (const id of nextExerciseIds) {
      if (cards.length >= 3) break
      addExerciseById(id)
    }
  }

  // Fresh account, or the bank widening left the Planner's list short: fill
  // locally against the bundle rather than ever rendering an empty slot,
  // preferring distinct patterns exactly as `provisionalPlan` does.
  if (cards.length < 3 && currentClo) {
    for (const pick of fillDistinctPatterns(currentClo.id, exercises, used)) {
      if (cards.length >= 3) break
      addExercise(pick, { pickedForYou: true })
    }
  }

  return cards
}
