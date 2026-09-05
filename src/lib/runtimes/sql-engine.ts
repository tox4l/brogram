import type { SqlJsStatic } from 'sql.js'
import type { RuntimeEngine } from './worker-host'

const loadBrowserSql = () => import('sql.js').then((module) => module.default({ locateFile: (file) => `/${file}` }))

export function createSqlEngine(load: () => Promise<SqlJsStatic> = loadBrowserSql): RuntimeEngine {
  let databaseModule: Promise<SqlJsStatic> | undefined
  const ready = () => databaseModule ??= load()
  return {
    async warmup(_packages, progress) {
      progress('sql.js')
      progress('sql-wasm.wasm')
      await ready()
    },
    async execute(req, test) {
      const SQL = await ready()
      // Match scripts/verify-exercise.mjs: each test reloads its fixture, so
      // after mutations cannot contaminate the next test.
      const db = new SQL.Database()
      try {
        if (req.fixture) db.run(req.fixture)
        // RunRequest has no kind. Fixed SQL checks without a __STUDENT__ token
        // are schema checks and run student DDL before inspecting the schema.
        const schemaMode = Boolean(test) && !req.tests.some((item) => item.input.includes('__STUDENT__'))
        if (schemaMode) db.run(req.code)
        let query = test?.input ?? req.code
        if (!schemaMode) query = query.replaceAll('__STUDENT__', req.code.trim().replace(/;\s*$/, ''))
        const after = query.match(/\/\*\s*after:\s*([\s\S]*?)\*\//)
        if (after) {
          db.run(after[1].trim())
          query = query.replace(after[0], '').trim()
        }
        const rows = db.exec(query)
        const actual = JSON.stringify(rows.length ? { columns: rows[0].columns, values: rows[0].values } : { columns: [], values: [] })
        return { actual, stdout: test ? '' : actual, stderr: '' }
      } finally {
        db.close()
      }
    },
  }
}
