// @vitest-environment node
import { describe, expect, it } from 'vitest'
import sqlBank from '../../../seed/exercises/INFS2201.json'
import type { RunRequest } from '../contracts'
import { createEngineWorker } from './engine-worker.test-support'
import { MongoAdapter } from './mongo'
import { createMongoEngine } from './mongo-engine'

const adapter = () => new MongoAdapter(() => createEngineWorker(createMongoEngine()))
const fixture = '[{"name":"Noor","city":"Doha","score":2},{"name":"Ali","city":"Doha","score":3},{"name":"Lina","city":"Lusail","score":1}]'
function request(code: string, op: string, args: unknown[], expected: string): RunRequest {
  return { language: 'mongo', code, fixture, timeoutMs: 5000, tests: [{ id: 'golden', input: JSON.stringify({ op, args }), expected, hidden: false }] }
}

describe('Mongo runtime', () => {
  it('uses a student query object when find args are empty', async () => {
    const result = await adapter().run(request('{"score":{"$gt":2}}', 'find', [], '[{"name":"Ali","city":"Doha","score":3}]'))
    expect(result.results[0].passed).toBe(true)
  })

  it('uses a student pipeline when aggregate args are empty', async () => {
    const result = await adapter().run(request('[{"$group":{"_id":"$city","total":{"$sum":"$score"}}},{"$sort":{"total":-1}}]', 'aggregate', [], '[{"total":5},{"total":1}]'))
    expect(result.results[0].passed).toBe(true)
  })

  it('substitutes sentinel args while preserving a fixed projection', async () => {
    const result = await adapter().run(request('{"score":{"$gt":2}}', 'find', ['__STUDENT__', { name: 1, _id: 0 }], '[{"name":"Ali"}]'))
    expect(result.results[0].passed).toBe(true)
  })

  it('substitutes an entire student update pair and reloads fixture per test', async () => {
    const req = request('[{"city":"Doha"},{"$inc":{"score":1}}]', 'update', ['__STUDENT__'], '[{"name":"Noor","city":"Doha","score":3},{"name":"Ali","city":"Doha","score":4},{"name":"Lina","city":"Lusail","score":1}]')
    req.tests.push({ ...req.tests[0], id: 'fresh' })
    expect((await adapter().run(req)).passedCount).toBe(2)
  })

  it('uses fixed check args without attempting to evaluate shell code', async () => {
    const result = await adapter().run(request('db.people.find({score: 2})', 'find', [{ score: 2 }], '[{"name":"Noor","city":"Doha","score":2}]'))
    expect(result.results[0].passed).toBe(true)
  })

  it('rejects invalid student JSON with a useful runtime error', async () => {
    const result = await adapter().run(request('db.people.find({})', 'find', [], '[]'))
    expect(result.results[0]).toMatchObject({ passed: false, failureKind: 'runtime-error' })
    expect(result.results[0].stderr).toBeTruthy()
  })

  it('runs an update pair without tests and shows the changed collection', async () => {
    const result = await adapter().run({ language: 'mongo', code: '[{"score":3},{"$inc":{"score":2}}]', fixture, tests: [], timeoutMs: 5000 })
    expect(JSON.parse(result.stdout!)).toEqual([{ name: 'Noor', city: 'Doha', score: 2 }, { name: 'Ali', city: 'Doha', score: 5 }, { name: 'Lina', city: 'Lusail', score: 1 }])
  })

  for (const exercise of sqlBank.exercises.filter((item) => item.language === 'mongo')) {
    it(`grades the bank reference: ${exercise.title}`, async () => {
      const result = await adapter().run({ language: 'mongo', code: exercise.referenceSolution, fixture: exercise.fixture, tests: exercise.tests, timeoutMs: 5000 })
      expect(result.results.filter((test) => !test.passed)).toEqual([])
    })
  }
})
