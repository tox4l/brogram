import type { RuntimeEngine } from './worker-host'

type Document = Record<string, unknown>
type MongoModule = typeof import('mingo')

function document(value: unknown): Document {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Mongo queries and update documents must be JSON objects.')
  return value as Document
}

function substitute(value: unknown, student: () => unknown): unknown {
  if (value === '__STUDENT__') return student()
  if (Array.isArray(value)) return value.map((item) => substitute(item, student))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item, student)]))
  return value
}

function freeRunOperation(value: unknown): 'find' | 'aggregate' | 'update' {
  if (!Array.isArray(value)) return 'find'
  // Without test metadata a two-document pair beginning with a plain filter
  // is an update; arrays of $stage documents are aggregation pipelines.
  if (value.length === 2 && Object.keys(document(value[0])).every((key) => !key.startsWith('$'))) return 'update'
  return 'aggregate'
}

export function createMongoEngine(): RuntimeEngine {
  let engine: Promise<MongoModule> | undefined
  const ready = () => engine ??= import('mingo')
  return {
    async warmup(_packages, progress) {
      progress('mingo')
      await ready()
    },
    async execute(req, test) {
      // The top-level mingo exports preload the query, aggregation, and update
      // operators. The smaller query/aggregator subpaths do not.
      const mingo = await ready()
      const fixture: unknown = JSON.parse(req.fixture ?? '[]')
      if (!Array.isArray(fixture)) throw new Error('Mongo fixture must be a JSON array of documents.')
      const docs = fixture.map(document)
      const fixtureHasId = docs.some((item) => Object.hasOwn(item, '_id'))
      let parsedStudent: unknown
      let parsed = false
      const student = () => {
        if (!parsed) { parsedStudent = JSON.parse(req.code); parsed = true }
        return parsedStudent
      }
      // Author leaves args open: non-empty args are fixed checks (the current
      // seed convention). Empty args or __STUDENT__ substitute student JSON:
      // one query object, a pipeline array, or [filter, update], respectively.
      const spec = test ? document(JSON.parse(test.input)) : { op: freeRunOperation(student()), args: [] }
      const fixedArgs = spec.args ?? []
      if (!Array.isArray(fixedArgs)) throw new Error('Mongo test args must be a JSON array.')
      let args: unknown[]
      if (!fixedArgs.length || (fixedArgs.length === 1 && fixedArgs[0] === '__STUDENT__' && spec.op === 'update')) {
        const value = student()
        if (spec.op === 'update') {
          if (!Array.isArray(value) || value.length !== 2) throw new Error('Mongo update code must be [filter, update].')
          args = value
        } else args = [value]
      } else args = fixedArgs.map((value) => substitute(value, student))

      let value: unknown[]
      if (spec.op === 'find') {
        value = mingo.find(docs, document(args[0]), args[1] === undefined ? undefined : document(args[1])).all()
      } else if (spec.op === 'aggregate') {
        if (!Array.isArray(args[0])) throw new Error('Mongo aggregate code must be a JSON pipeline array.')
        value = mingo.aggregate(docs, args[0].map(document))
      } else if (spec.op === 'update') {
        mingo.updateMany(docs, document(args[0]), document(args[1]))
        value = docs
      } else throw new Error(`Unsupported Mongo operation: ${String(spec.op)}`)

      // Keep verifier output compatible with fixtures that omit Mongo ids.
      if (!fixtureHasId) for (const item of value) if (item && typeof item === 'object') delete (item as Document)._id
      const actual = JSON.stringify(value)
      return { actual, stdout: test ? '' : actual, stderr: '' }
    },
  }
}
