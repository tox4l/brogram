// @vitest-environment node
import initSqlJs from 'sql.js'
import { describe, expect, it } from 'vitest'
import smoke from '../../../seed/exercises/smoke.json'
import sqlBank from '../../../seed/exercises/INFS2201.json'
import { createEngineWorker } from './engine-worker.test-support'
import { SqlAdapter } from './sql'
import { createSqlEngine } from './sql-engine'

const database = initSqlJs()
const adapter = () => new SqlAdapter(() => createEngineWorker(createSqlEngine(() => database)))

describe('SQL runtime', () => {
  it('grades every smoke test with fixture and after mutations isolated per test', async () => {
    const exercise = smoke.exercises.find((item) => item.language === 'sql')!
    const result = await adapter().run({ language: 'sql', code: exercise.referenceSolution, fixture: exercise.fixture, tests: exercise.tests, timeoutMs: 5000 })
    expect(result.ok).toBe(true)
    expect(result.passedCount).toBe(5)
  })

  it('executes student schema before fixed structural checks', async () => {
    const result = await adapter().run({ language: 'sql', code: 'create table notes(id integer primary key, title text not null);', tests: [{ id: 'structure', input: 'select name from sqlite_master where type = \'table\' order by name', expected: '{"values":[["notes"]],"columns":["name"]}', hidden: false }], timeoutMs: 5000 })
    expect(result.results[0].passed).toBe(true)
  })

  it('reports wrong SQL and invalid SQL separately', async () => {
    const test = { id: 'query', input: '__STUDENT__', expected: '{"columns":["value"],"values":[[2]]}', hidden: false }
    const runtime = adapter()
    const wrong = await runtime.run({ language: 'sql', code: 'select 1 as value', tests: [test], timeoutMs: 5000 })
    const broken = await runtime.run({ language: 'sql', code: 'not valid SQL', tests: [test], timeoutMs: 5000 })
    expect(wrong.results[0].failureKind).toBe('wrong-answer')
    expect(broken.results[0]).toMatchObject({ failureKind: 'runtime-error', passed: false })
    expect(broken.results[0].stderr).toBeTruthy()
  })

  it('shows query rows on a free run', async () => {
    const result = await adapter().run({ language: 'sql', code: 'select 7 as value;', tests: [], timeoutMs: 5000 })
    expect(JSON.parse(result.stdout!)).toEqual({ columns: ['value'], values: [[7]] })
  })

  for (const exercise of sqlBank.exercises.filter((item) => item.language === 'sql' && ['code', 'schema'].includes(item.kind))) {
    it(`grades the bank reference: ${exercise.title}`, async () => {
      const result = await adapter().run({ language: 'sql', code: exercise.referenceSolution, fixture: exercise.fixture, tests: exercise.tests, timeoutMs: 5000 })
      expect(result.results.filter((test) => !test.passed)).toEqual([])
    })
  }
})
