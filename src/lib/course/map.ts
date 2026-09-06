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

export type NodeState = 'locked' | 'available' | 'walkthrough-ready' | 'in-progress' | 'locked-in'

export interface MapNode {
  cloId: CloId
  title: string
  ordinal: number
  state: NodeState
  chain: number
  closed: boolean
  draft: boolean
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
 */
export function buildMap(args: {
  clos: readonly Clo[]
  code: CourseCode
  mastery: LearnerState['mastery']
  lessonProgress: readonly LessonProgress[]
}): MapNode[] {
  const { code, mastery, lessonProgress } = args
  const courseClos = args.clos.filter((clo) => clo.course === code)
  const inCourseIds = new Set(courseClos.map((clo) => clo.id))

  return courseClos.map((clo) => {
    const prerequisites = clo.prerequisites.filter((id) => inCourseIds.has(id))
    const externalPrerequisites = clo.prerequisites.filter((id) => !inCourseIds.has(id))
    const cloMastery = mastery[clo.id]
    const closed = cloMastery?.closed ?? false
    const chain = cloMastery?.chain ?? 0
    const prerequisitesClosed = prerequisites.every((id) => mastery[id]?.closed ?? false)

    let state: NodeState
    if (!prerequisitesClosed) {
      state = 'locked'
    } else if (closed) {
      state = 'locked-in'
    } else if (chain > 0) {
      state = 'in-progress'
    } else {
      // Correction 2: "unseen" is not a status -- it is the absence of a row.
      const progress = lessonProgress.find((row) => row.cloId === clo.id)
      state = !progress || progress.status === 'started' ? 'walkthrough-ready' : 'available'
    }

    return {
      cloId: clo.id,
      title: clo.outcome,
      ordinal: clo.ordinal,
      state,
      chain,
      closed,
      draft: clo.draft ?? false,
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
export function nodeAccessibleName(node: Pick<MapNode, 'title' | 'state' | 'chain' | 'draft'>): string {
  const base = `${node.title} — ${stateLabel(node)}`
  return node.draft ? `${base}, drafted` : base
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
  /** False when no lesson exists yet for this skill in the static bundle -- the
   *  card renders a placeholder instead of a broken link (only the golden
   *  lesson exists until T1.1's batch lands). */
  lessonAvailable?: boolean
}

/**
 * R3.8: the Next-up stack is always exactly three cards.
 *  - If the current CLO has no `lesson_progress` row, or one with
 *    `status: 'started'`: card 1 is the walkthrough, cards 2 and 3 are the
 *    Planner's first two `nextExerciseIds`, at full opacity, captioned.
 *  - Otherwise the three cards are `nextExerciseIds` in Planner order.
 *  - Short lists are filled from `pickFromBank`, locally, against the bundle
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
  const walkthroughDue = currentClo !== null && (!progress || progress.status === 'started')

  const cards: NextUpCard[] = []
  const used = new Set<string>()

  function addExercise(id: string, extra: Partial<NextUpCard> = {}): boolean {
    if (used.has(id)) return false
    const exercise = exercises.find((row) => row.id === id)
    if (!exercise) return false
    used.add(id)
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

  if (walkthroughDue && currentClo) {
    const lesson = lessons.find((row) => row.cloId === currentClo.id)
    cards.push({
      kind: 'walkthrough',
      id: currentClo.id,
      cloId: currentClo.id,
      title: lesson ? lesson.title : currentClo.outcome,
      href: `/lesson/${encodeURIComponent(currentClo.id)}`,
      lessonAvailable: Boolean(lesson),
    })
    for (const id of nextExerciseIds) {
      if (cards.length >= 3) break
      addExercise(id, { caption: 'After the walkthrough, or skip it.' })
    }
  } else {
    for (const id of nextExerciseIds) {
      if (cards.length >= 3) break
      addExercise(id)
    }
  }

  // Fresh account, or the bank widening left the Planner's list short: fill
  // locally against the bundle rather than ever rendering an empty slot.
  if (cards.length < 3 && currentClo) {
    for (let attempt = 0; cards.length < 3 && attempt < MAX_FILL_ATTEMPTS; attempt += 1) {
      const picked = pickFromBank({ cloId: currentClo.id, difficulty: DEFAULT_DIFFICULTY, excludeExerciseIds: [...used] }, exercises as ExercisePublic[])
      if (!picked) break
      if (!addExercise(picked.id, { pickedForYou: true })) break
    }
  }

  return cards
}
