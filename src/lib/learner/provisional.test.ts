import { describe, expect, it } from 'vitest'
import type { Clo, ExercisePublic, LearnerState, Mastery } from '@/lib/contracts'
import { provisionalPlan } from './provisional'

function clo(overrides: Partial<Clo> & Pick<Clo, 'id' | 'ordinal'>): Clo {
  return {
    course: 'C1',
    outcome: overrides.outcome ?? `Outcome for ${overrides.id}`,
    topics: [],
    prerequisites: [],
    patterns: [],
    assessableInCode: true,
    ...overrides,
  }
}

function exercise(overrides: Partial<ExercisePublic> & Pick<ExercisePublic, 'id' | 'cloId' | 'pattern'>): ExercisePublic {
  return {
    language: 'python',
    kind: 'code',
    difficulty: 3,
    title: `Exercise ${overrides.id}`,
    prompt: '',
    starterCode: '',
    tests: [],
    origin: 'seed',
    tags: [],
    ...overrides,
  }
}

function mastery(cloId: string, closed: boolean): Record<string, Mastery> {
  return { [cloId]: { userId: 'u1', cloId, score: closed ? 100 : 40, chain: closed ? 3 : 1, patternsPassed: [], closed, lastAttemptAt: null } }
}

describe('provisionalPlan — path', () => {
  it('orders a course with no prerequisites by ordinal', () => {
    const clos = [
      clo({ id: 'C1-3', ordinal: 3 }),
      clo({ id: 'C1-1', ordinal: 1 }),
      clo({ id: 'C1-2', ordinal: 2 }),
    ]
    const plan = provisionalPlan({ code: 'C1', clos, exercises: [], mastery: {} })
    expect(plan.path).toEqual(['C1-1', 'C1-2', 'C1-3'])
  })

  it('topologically sorts on in-course prerequisites even when the input array is out of order', () => {
    const clos = [
      clo({ id: 'C1-3', ordinal: 3, prerequisites: ['C1-2'] }),
      clo({ id: 'C1-1', ordinal: 1, prerequisites: [] }),
      clo({ id: 'C1-2', ordinal: 2, prerequisites: ['C1-1'] }),
    ]
    const plan = provisionalPlan({ code: 'C1', clos, exercises: [], mastery: {} })
    expect(plan.path).toEqual(['C1-1', 'C1-2', 'C1-3'])
  })

  it('reorders when the seed ordinal disagrees with the real prerequisite chain', () => {
    // C1-2 is authored at ordinal 1 but actually depends on C1-1 (ordinal 2):
    // the topological order must still put C1-1 first.
    const clos = [
      clo({ id: 'C1-2', ordinal: 1, prerequisites: ['C1-1'] }),
      clo({ id: 'C1-1', ordinal: 2, prerequisites: [] }),
    ]
    const plan = provisionalPlan({ code: 'C1', clos, exercises: [], mastery: {} })
    expect(plan.path).toEqual(['C1-1', 'C1-2'])
  })

  it('ignores a dangling external prerequisite id (a different course entirely) rather than treating it as a cycle', () => {
    // Mirrors the real seed: INFS1201-1 lists INFS1101-4 as a prerequisite.
    const clos = [
      clo({ id: 'C2-1', ordinal: 1, course: 'C2', prerequisites: ['C1-4'] }),
      clo({ id: 'C2-2', ordinal: 2, course: 'C2', prerequisites: ['C2-1'] }),
    ]
    const plan = provisionalPlan({ code: 'C2', clos, exercises: [], mastery: {} })
    expect(plan.path).toEqual(['C2-1', 'C2-2'])
  })

  it('falls back to ordinal order on a genuine in-course cycle', () => {
    const clos = [
      clo({ id: 'C1-1', ordinal: 1, prerequisites: ['C1-2'] }),
      clo({ id: 'C1-2', ordinal: 2, prerequisites: ['C1-1'] }),
    ]
    const plan = provisionalPlan({ code: 'C1', clos, exercises: [], mastery: {} })
    expect(plan.path).toEqual(['C1-1', 'C1-2'])
  })

  it('returns an empty path for a course with no CLOs', () => {
    const plan = provisionalPlan({ code: 'C1', clos: [], exercises: [], mastery: {} })
    expect(plan.path).toEqual([])
    expect(plan.nextExerciseIds).toEqual([])
  })

  it('only considers CLOs that belong to the given course code', () => {
    const clos = [
      clo({ id: 'C1-1', ordinal: 1, course: 'C1' }),
      clo({ id: 'C2-1', ordinal: 1, course: 'C2' }),
    ]
    const plan = provisionalPlan({ code: 'C1', clos, exercises: [], mastery: {} })
    expect(plan.path).toEqual(['C1-1'])
  })
})

describe('provisionalPlan — nextExerciseIds', () => {
  const clos = [
    clo({ id: 'C1-1', ordinal: 1 }),
    clo({ id: 'C1-2', ordinal: 2, prerequisites: ['C1-1'] }),
  ]

  it('picks three distinct-pattern exercises at DEFAULT_DIFFICULTY for the first non-closed CLO', () => {
    const exercises = [
      exercise({ id: 'e1', cloId: 'C1-1', pattern: 'guard', difficulty: 3 }),
      exercise({ id: 'e2', cloId: 'C1-1', pattern: 'accumulate', difficulty: 3 }),
      exercise({ id: 'e3', cloId: 'C1-1', pattern: 'filter', difficulty: 3 }),
      exercise({ id: 'e4', cloId: 'C1-1', pattern: 'guard', difficulty: 3 }), // same pattern as e1 — must not be picked twice
      exercise({ id: 'e5', cloId: 'C1-2', pattern: 'search', difficulty: 3 }),
    ]
    const plan = provisionalPlan({ code: 'C1', clos, exercises, mastery: {} })
    expect(plan.nextExerciseIds).toHaveLength(3)
    expect(new Set(plan.nextExerciseIds).size).toBe(3)
    expect(plan.nextExerciseIds).not.toContain('e5')
    const patterns = plan.nextExerciseIds.map((id) => exercises.find((e) => e.id === id)!.pattern)
    expect(new Set(patterns).size).toBe(patterns.length)
  })

  it('targets the first CLO that is not yet closed, skipping a closed one', () => {
    const exercises = [
      exercise({ id: 'e1', cloId: 'C1-1', pattern: 'guard' }),
      exercise({ id: 'e2', cloId: 'C1-2', pattern: 'search' }),
      exercise({ id: 'e3', cloId: 'C1-2', pattern: 'nested-loop' }),
      exercise({ id: 'e4', cloId: 'C1-2', pattern: 'boundary' }),
    ]
    const plan = provisionalPlan({ code: 'C1', clos, exercises, mastery: mastery('C1-1', true) })
    expect(plan.nextExerciseIds.every((id) => ['e2', 'e3', 'e4'].includes(id))).toBe(true)
    expect(plan.nextExerciseIds).not.toContain('e1')
  })

  it('falls back to the last CLO in the path when every CLO is already closed', () => {
    const exercises = [exercise({ id: 'e1', cloId: 'C1-2', pattern: 'search' })]
    const closedMastery = { ...mastery('C1-1', true), ...mastery('C1-2', true) }
    const plan = provisionalPlan({ code: 'C1', clos, exercises, mastery: closedMastery })
    expect(plan.nextExerciseIds).toEqual(['e1'])
  })

  it('returns fewer than three ids when the bank does not have three distinct patterns', () => {
    const exercises = [exercise({ id: 'e1', cloId: 'C1-1', pattern: 'guard' })]
    const plan = provisionalPlan({ code: 'C1', clos, exercises, mastery: {} })
    expect(plan.nextExerciseIds).toEqual(['e1'])
  })

  it('returns an empty list when the target CLO has no bank exercises at all', () => {
    const plan = provisionalPlan({ code: 'C1', clos, exercises: [], mastery: {} })
    expect(plan.nextExerciseIds).toEqual([])
  })
})

describe('provisionalPlan — pure, no state mutation', () => {
  it('never mutates its inputs', () => {
    const clos = [clo({ id: 'C1-2', ordinal: 2, prerequisites: ['C1-1'] }), clo({ id: 'C1-1', ordinal: 1 })]
    const exercises = [exercise({ id: 'e1', cloId: 'C1-1', pattern: 'guard' })]
    const mastery: LearnerState['mastery'] = {}
    const closCopy = clos.map((c) => ({ ...c }))
    const exercisesCopy = exercises.map((e) => ({ ...e }))

    provisionalPlan({ code: 'C1', clos, exercises, mastery })

    expect(clos).toEqual(closCopy)
    expect(exercises).toEqual(exercisesCopy)
  })
})
