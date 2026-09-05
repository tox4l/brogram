import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BankQuery, ExercisePublic } from '@/lib/contracts'
import { fetchBank, pickFromBank, toExercisePublic } from './bank'

const CLO = 'INFS1101-3'

function ex(id: string, over: Partial<ExercisePublic> = {}): ExercisePublic {
  return {
    id,
    cloId: CLO,
    language: 'python',
    kind: 'code',
    difficulty: 3,
    pattern: 'loop-accumulate',
    title: id,
    prompt: 'Do the thing.',
    starterCode: '',
    tests: [],
    origin: 'seed',
    tags: [],
    ...over,
  }
}

function query(over: Partial<BankQuery> = {}): BankQuery {
  return { cloId: CLO, ...over }
}

const fullRow = {
  id: 'ex-1',
  clo_id: CLO,
  language: 'python',
  kind: 'code',
  difficulty: 4,
  pattern: 'guard-clause',
  title: 'Sum a list',
  prompt: 'Add the numbers.',
  starter_code: 'def solve(xs):\n    pass\n',
  tests: [{ id: 't1', input: '[1, 2]', expected: '3', hidden: true, name: 'sums two' }],
  origin: 'generated',
  parent_exercise_id: 'ex-0',
  author_user_id: 'user-1',
  verified: true,
  tags: ['lists', 'loops'],
  fixture: 'setup sql',
  created_at: '2026-03-01T00:00:00.000Z',
}

describe('toExercisePublic', () => {
  it('maps every column of the view onto the contract shape', () => {
    expect(toExercisePublic(fullRow)).toEqual({
      id: 'ex-1',
      cloId: CLO,
      language: 'python',
      kind: 'code',
      difficulty: 4,
      pattern: 'guard-clause',
      title: 'Sum a list',
      prompt: 'Add the numbers.',
      starterCode: 'def solve(xs):\n    pass\n',
      tests: [{ id: 't1', input: '[1, 2]', expected: '3', hidden: true, name: 'sums two' }],
      origin: 'generated',
      parentExerciseId: 'ex-0',
      tags: ['lists', 'loops'],
      fixture: 'setup sql',
    })
  })

  it('never carries a reference solution or the view-only columns', () => {
    const mapped = toExercisePublic({ ...fullRow, reference_solution: 'print(sum(xs))' }) as Record<string, unknown>
    expect(mapped.referenceSolution).toBeUndefined()
    expect(mapped.reference_solution).toBeUndefined()
    expect(Object.keys(mapped).sort()).toEqual(
      ['cloId', 'difficulty', 'fixture', 'id', 'kind', 'language', 'origin', 'parentExerciseId', 'pattern', 'prompt', 'starterCode', 'tags', 'tests', 'title'].sort(),
    )
    expect(mapped.authorUserId).toBeUndefined()
    expect(mapped.verified).toBeUndefined()
    expect(mapped.createdAt).toBeUndefined()
  })

  it('leaves the optional columns off when the row has nulls, and defaults the rest', () => {
    const mapped = toExercisePublic({
      id: 'ex-2',
      clo_id: CLO,
      language: 'sql',
      kind: 'schema',
      difficulty: 2,
      pattern: 'table-design',
      title: 'Design it',
      prompt: 'Two tables.',
      starter_code: null,
      tests: null,
      origin: 'seed',
      parent_exercise_id: null,
      tags: null,
      fixture: null,
    })
    expect(mapped).toEqual({
      id: 'ex-2',
      cloId: CLO,
      language: 'sql',
      kind: 'schema',
      difficulty: 2,
      pattern: 'table-design',
      title: 'Design it',
      prompt: 'Two tables.',
      starterCode: '',
      tests: [],
      origin: 'seed',
      tags: [],
    })
    expect(Object.keys(mapped)).not.toContain('parentExerciseId')
    expect(Object.keys(mapped)).not.toContain('fixture')
  })
})

describe('pickFromBank', () => {
  it('prefers a pattern the student has not passed yet', () => {
    const rows = [ex('a', { pattern: 'loop-accumulate' }), ex('b', { pattern: 'guard-clause' })]
    expect(pickFromBank(query({ difficulty: 3, preferPatterns: ['guard-clause'] }), rows)?.id).toBe('b')
  })

  it('excludes exercises the student saw recently', () => {
    const rows = [ex('b1', { pattern: 'guard-clause' }), ex('b2', { pattern: 'guard-clause' })]
    expect(pickFromBank(query({ preferPatterns: ['guard-clause'], excludeExerciseIds: ['b1'] }), rows)?.id).toBe('b2')
  })

  it('never returns an excluded pattern, not even as the last resort', () => {
    const rows = [ex('a', { pattern: 'loop-accumulate' })]
    expect(pickFromBank(query({ excludePatterns: ['loop-accumulate'] }), rows)).toBeNull()
  })

  it('drops the pattern preference before it widens the difficulty', () => {
    const rows = [ex('g4', { pattern: 'guard-clause', difficulty: 4 }), ex('l2', { pattern: 'loop-accumulate', difficulty: 2 })]
    expect(pickFromBank(query({ difficulty: 1, preferPatterns: ['guard-clause'] }), rows)?.id).toBe('l2')
  })

  it('widens the difficulty to plus or minus 2 when plus or minus 1 is empty', () => {
    const rows = [ex('g3', { pattern: 'guard-clause', difficulty: 3 })]
    expect(pickFromBank(query({ difficulty: 1, preferPatterns: ['guard-clause'] }), rows)?.id).toBe('g3')
  })

  it('falls back to any unseen exercise on the CLO', () => {
    const rows = [ex('x5', { pattern: 'two-pointer', difficulty: 5 })]
    expect(pickFromBank(query({ difficulty: 1, preferPatterns: ['guard-clause'] }), rows)?.id).toBe('x5')
  })

  it('takes the difficulty closest to the target inside a tier', () => {
    const rows = [ex('d4', { difficulty: 4 }), ex('d3', { difficulty: 3 })]
    expect(pickFromBank(query({ difficulty: 3 }), rows)?.id).toBe('d3')
  })

  it('targets difficulty 3 when the query does not say', () => {
    const rows = [ex('d1', { difficulty: 1 }), ex('d3', { difficulty: 3 })]
    expect(pickFromBank(query(), rows)?.id).toBe('d3')
  })

  it('honours the language filter', () => {
    const rows = [ex('js', { language: 'javascript' })]
    expect(pickFromBank(query({ language: 'python' }), rows)).toBeNull()
    expect(pickFromBank(query({ language: 'javascript' }), rows)?.id).toBe('js')
  })

  it('ignores exercises from another CLO', () => {
    const rows = [ex('other', { cloId: 'INFS1101-4' })]
    expect(pickFromBank(query(), rows)).toBeNull()
  })

  it('returns null only when the CLO has nothing unseen', () => {
    expect(pickFromBank(query(), [])).toBeNull()
    expect(pickFromBank(query({ excludeExerciseIds: ['a'] }), [ex('a')])).toBeNull()
    expect(pickFromBank(query({ excludeExerciseIds: ['a'] }), [ex('a'), ex('b', { difficulty: 5 })])?.id).toBe('b')
  })
})

interface FakeCall {
  table?: string
  columns?: string
  eq?: [string, unknown]
}

function fakeClient(result: { data: unknown; error: unknown }) {
  const calls: FakeCall[] = []
  const client = {
    from(table: string) {
      calls.push({ table })
      return {
        select(columns: string) {
          calls.push({ columns })
          return {
            eq(column: string, value: unknown) {
              calls.push({ eq: [column, value] })
              return Promise.resolve(result)
            },
          }
        },
      }
    },
  }
  return { client: client as unknown as SupabaseClient, calls }
}

describe('fetchBank', () => {
  it('reads exercises_public for the CLO and maps the rows', async () => {
    const { client, calls } = fakeClient({ data: [fullRow], error: null })
    const rows = await fetchBank(client, query())

    expect(calls[0].table).toBe('exercises_public')
    expect(calls[2].eq).toEqual(['clo_id', CLO])
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('ex-1')
    expect(rows[0].cloId).toBe(CLO)
    expect((rows[0] as Record<string, unknown>).referenceSolution).toBeUndefined()
  })

  it('never reads the exercises table', async () => {
    const { client, calls } = fakeClient({ data: [], error: null })
    await fetchBank(client, query())
    expect(calls.map((c) => c.table).filter(Boolean)).toEqual(['exercises_public'])
  })

  it('returns an empty list when the view has nothing', async () => {
    const { client } = fakeClient({ data: null, error: null })
    expect(await fetchBank(client, query())).toEqual([])
  })

  it('throws when the query fails', async () => {
    const { client } = fakeClient({ data: null, error: { message: 'permission denied' } })
    await expect(fetchBank(client, query())).rejects.toThrow('permission denied')
  })
})
