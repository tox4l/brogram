import { describe, expect, it } from 'vitest'
import type { Clo, ExercisePublic, LearnerState, LessonProgress, LessonPublic } from '@/lib/contracts'
import { buildMap, currentCloId, nextUp, nodeAccessibleName } from './map'

function clo(overrides: Partial<Clo> & { id: string; course: string; ordinal: number }): Clo {
  return {
    outcome: `Outcome for ${overrides.id}`,
    topics: [],
    prerequisites: [],
    patterns: ['pattern-a'],
    assessableInCode: true,
    ...overrides,
  }
}

function mastery(entries: Record<string, { closed: boolean; chain?: number }>): LearnerState['mastery'] {
  const out: LearnerState['mastery'] = {}
  for (const [cloId, value] of Object.entries(entries)) {
    out[cloId] = {
      userId: 'learner-one', cloId, score: 0,
      chain: value.chain ?? 0, patternsPassed: [], closed: value.closed, lastAttemptAt: null,
    }
  }
  return out
}

function progressRow(overrides: Partial<LessonProgress> & { cloId: string }): LessonProgress {
  return {
    userId: 'learner-one', lessonId: overrides.cloId, status: 'started', blockIndex: 0,
    checksPassed: 0, checksFailed: 0, lessonVersion: 1, startedAt: '2026-09-05T09:00:00Z', completedAt: null,
    updatedAt: '2026-09-05T09:00:00Z',
    ...overrides,
  }
}

describe('buildMap', () => {
  it('locks a node only when an IN-COURSE prerequisite is open', () => {
    const clos = [
      clo({ id: 'C-1', course: 'C', ordinal: 1 }),
      clo({ id: 'C-2', course: 'C', ordinal: 2, prerequisites: ['C-1'] }),
    ]
    const nodes = buildMap({ clos, code: 'C', mastery: mastery({}), lessonProgress: [] })
    expect(nodes.find((n) => n.cloId === 'C-1')?.state).not.toBe('locked')
    expect(nodes.find((n) => n.cloId === 'C-2')?.state).toBe('locked')
  })

  it('correction 1: a learner whose only course is INFS1201 sees available nodes, not a wall of locked ones', () => {
    // The shipped seed has INFS1201-1 list INFS1101-4 as a prerequisite -- a
    // course this learner has never opened. That cross-course id must never
    // gate; only prerequisites that are also in THIS course's CLO list can.
    const clos = [clo({ id: 'INFS1201-1', course: 'INFS1201', ordinal: 1, prerequisites: ['INFS1101-4'] })]
    const nodes = buildMap({ clos, code: 'INFS1201', mastery: mastery({}), lessonProgress: [] })
    expect(nodes[0].state).not.toBe('locked')
    expect(nodes[0].externalPrerequisites).toEqual(['INFS1101-4'])
    expect(nodes[0].prerequisites).toEqual([])
  })

  it('correction 2: a CLO with no lesson_progress row is walkthrough-ready, never "unseen"', () => {
    const clos = [clo({ id: 'C-1', course: 'C', ordinal: 1 })]
    const nodes = buildMap({ clos, code: 'C', mastery: mastery({}), lessonProgress: [] })
    expect(nodes[0].state).toBe('walkthrough-ready')
  })

  it('a CLO with a "started" lesson_progress row is still walkthrough-ready', () => {
    const clos = [clo({ id: 'C-1', course: 'C', ordinal: 1 })]
    const nodes = buildMap({
      clos, code: 'C', mastery: mastery({}),
      lessonProgress: [progressRow({ cloId: 'C-1', status: 'started' })],
    })
    expect(nodes[0].state).toBe('walkthrough-ready')
  })

  it('a CLO with a "completed" lesson_progress row and no chain yet is plain available', () => {
    const clos = [clo({ id: 'C-1', course: 'C', ordinal: 1 })]
    const nodes = buildMap({
      clos, code: 'C', mastery: mastery({}),
      lessonProgress: [progressRow({ cloId: 'C-1', status: 'completed' })],
    })
    expect(nodes[0].state).toBe('available')
  })

  it('marks in-progress once the chain has started, and locked-in once closed', () => {
    const clos = [
      clo({ id: 'C-1', course: 'C', ordinal: 1 }),
      clo({ id: 'C-2', course: 'C', ordinal: 2 }),
    ]
    const nodes = buildMap({
      clos, code: 'C',
      mastery: mastery({ 'C-1': { closed: false, chain: 2 }, 'C-2': { closed: true, chain: 3 } }),
      lessonProgress: [],
    })
    expect(nodes.find((n) => n.cloId === 'C-1')).toMatchObject({ state: 'in-progress', chain: 2 })
    expect(nodes.find((n) => n.cloId === 'C-2')).toMatchObject({ state: 'locked-in', closed: true })
  })

  it('correction 3: a drafted CLO renders with the marker and is still usable, not locked or hidden', () => {
    const clos = [clo({ id: 'C-1', course: 'C', ordinal: 1, draft: true })]
    const nodes = buildMap({ clos, code: 'C', mastery: mastery({}), lessonProgress: [] })
    expect(nodes[0].draft).toBe(true)
    expect(nodes[0].state).toBe('walkthrough-ready')
    expect(nodeAccessibleName(nodes[0])).toContain('drafted')
  })

  it('filters clos down to the requested course, ignoring rows from other courses', () => {
    const clos = [
      clo({ id: 'C-1', course: 'C', ordinal: 1 }),
      clo({ id: 'D-1', course: 'D', ordinal: 1 }),
    ]
    const nodes = buildMap({ clos, code: 'C', mastery: mastery({}), lessonProgress: [] })
    expect(nodes.map((n) => n.cloId)).toEqual(['C-1'])
  })
})

describe('nodeAccessibleName', () => {
  it('states the skill, its state, and its progress together', () => {
    const name = nodeAccessibleName({ title: 'Loops that stop when you tell them to', state: 'in-progress', chain: 2, draft: false })
    expect(name).toBe('Loops that stop when you tell them to — in progress, 2 of 3')
  })
})

describe('currentCloId', () => {
  it('returns the first CLO in path order that is not closed', () => {
    const id = currentCloId(['C-1', 'C-2', 'C-3'], mastery({ 'C-1': { closed: true }, 'C-2': { closed: false } }))
    expect(id).toBe('C-2')
  })

  it('returns the last CLO in path order when everything is closed', () => {
    const id = currentCloId(['C-1', 'C-2', 'C-3'], mastery({ 'C-1': { closed: true }, 'C-2': { closed: true }, 'C-3': { closed: true } }))
    expect(id).toBe('C-3')
  })

  it('returns null for an empty path', () => {
    expect(currentCloId([], mastery({}))).toBeNull()
  })
})

describe('nextUp', () => {
  const clos = [clo({ id: 'C-1', course: 'C', ordinal: 1 })]
  const lessons: LessonPublic[] = [{
    id: 'C-1', cloId: 'C-1', course: 'C', language: 'python', version: 1, title: 'Stopping on command',
    hook: 'hook', estimatedMinutes: 5, draft: false, tags: [], blocks: [], exitLine: 'exit',
  }]

  function exercise(id: string, overrides: Partial<ExercisePublic> = {}): ExercisePublic {
    return {
      id, cloId: 'C-1', language: 'python', kind: 'code', difficulty: 3, pattern: 'pattern-a',
      title: `Exercise ${id}`, prompt: 'prompt', starterCode: '', tests: [], origin: 'seed', tags: [],
      ...overrides,
    }
  }

  it('leads with the walkthrough when there is no progress row, captioning the two exercises behind it', () => {
    const exercises = [exercise('E-1'), exercise('E-2'), exercise('E-3')]
    const cards = nextUp({ currentCloId: 'C-1', clos, lessons, lessonProgress: [], nextExerciseIds: ['E-1', 'E-2'], exercises })
    expect(cards).toHaveLength(3)
    expect(cards[0]).toMatchObject({ kind: 'walkthrough', title: 'Stopping on command', lessonAvailable: true })
    expect(cards[1]).toMatchObject({ kind: 'exercise', id: 'E-1', caption: 'After the walkthrough, or skip it.' })
    expect(cards[2]).toMatchObject({ kind: 'exercise', id: 'E-2', caption: 'After the walkthrough, or skip it.' })
    for (const card of cards) expect(card).not.toHaveProperty('disabled')
  })

  it('marks the walkthrough card unavailable, with a fallback title, when no lesson exists yet for the CLO', () => {
    const exercises = [exercise('E-1'), exercise('E-2')]
    const cards = nextUp({ currentCloId: 'C-1', clos, lessons: [], lessonProgress: [], nextExerciseIds: ['E-1'], exercises })
    expect(cards[0]).toMatchObject({ kind: 'walkthrough', lessonAvailable: false, title: 'Outcome for C-1' })
  })

  it('uses the Planner order directly once the walkthrough is done', () => {
    const exercises = [exercise('E-1'), exercise('E-2'), exercise('E-3')]
    const cards = nextUp({
      currentCloId: 'C-1', clos, lessons,
      lessonProgress: [progressRow({ cloId: 'C-1', status: 'completed' })],
      nextExerciseIds: ['E-2', 'E-3', 'E-1'], exercises,
    })
    expect(cards.map((c) => c.id)).toEqual(['E-2', 'E-3', 'E-1'])
    expect(cards.every((c) => c.kind === 'exercise')).toBe(true)
  })

  it('always returns exactly three cards, filling a short Planner list locally against the bundle', () => {
    const exercises = [exercise('E-1'), exercise('E-2'), exercise('E-3'), exercise('E-4')]
    const cards = nextUp({
      currentCloId: 'C-1', clos, lessons,
      lessonProgress: [progressRow({ cloId: 'C-1', status: 'completed' })],
      nextExerciseIds: [], exercises,
    })
    expect(cards).toHaveLength(3)
    expect(cards.every((c) => c.pickedForYou)).toBe(true)
    const ids = new Set(cards.map((c) => c.id))
    expect(ids.size).toBe(3)
  })

  it('never renders an empty slot even when the bank cannot fill every seat', () => {
    const exercises = [exercise('E-1')]
    const cards = nextUp({
      currentCloId: 'C-1', clos, lessons,
      lessonProgress: [progressRow({ cloId: 'C-1', status: 'completed' })],
      nextExerciseIds: [], exercises,
    })
    expect(cards).toHaveLength(1)
    expect(cards[0].id).toBe('E-1')
  })

  it('returns an empty stack rather than throwing when there is no current CLO', () => {
    expect(nextUp({ currentCloId: null, clos, lessons, lessonProgress: [], nextExerciseIds: [], exercises: [] })).toEqual([])
  })
})
