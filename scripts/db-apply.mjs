// Applies unapplied files under supabase/migrations/, in order, over the
// Supabase session pooler. This is the applier that lived in the session
// scratchpad during v1 (R1.12: openness) — a committed, reproducible script
// instead of a one-off kept outside the repo.
//
// Reads SUPABASE_DB_URL from the environment: a full Postgres connection
// string for the session pooler, e.g.
//   postgres://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
// The direct host (db.<ref>.supabase.co) is IPv6-only and unreachable from
// this machine (build log 20:43), so the pooler is the only path.
//
// `pg` is not a project dependency (package.json is owned by another task in
// this wave), so it is imported dynamically. Run this script with NODE_PATH
// pointing at a node_modules that has `pg` installed if the repo's own
// node_modules does not carry it, e.g.:
//   NODE_PATH=/path/to/node_modules SUPABASE_DB_URL=... node scripts/db-apply.mjs
//
// Never prints a connection string, a password, or a key.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations')

async function loadPg() {
  try {
    return (await import('pg')).default
  } catch {
    throw new Error(
      'The "pg" package is not resolvable. It is not a dependency of this repo; ' +
        'run this script with NODE_PATH set to a node_modules directory that has ' +
        '"pg" installed (see the comment at the top of scripts/db-apply.mjs).',
    )
  }
}

function listMigrationFiles(dir = MIGRATIONS_DIR) {
  return readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()
}

function versionOf(filename) {
  const match = filename.match(/^(\d+)_/)
  if (!match) throw new Error(`Migration file does not start with a numeric version: ${filename}`)
  return match[1]
}

/** Applies every migration file not yet recorded in supabase_migrations.schema_migrations. Returns the list applied. */
export async function applyMigrations({ dryRun = false, dir = MIGRATIONS_DIR, connectionString } = {}) {
  if (!connectionString?.trim()) {
    throw new Error('SUPABASE_DB_URL is not set. Refusing to run without an explicit connection string.')
  }

  const files = listMigrationFiles(dir)
  const pg = dryRun ? null : await loadPg()
  const client = dryRun ? null : new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })

  if (client) await client.connect()

  try {
    let applied = new Set()
    if (client) {
      await client.query(
        'create schema if not exists supabase_migrations; ' +
          'create table if not exists supabase_migrations.schema_migrations (version text not null primary key, statements text[], name text)',
      )
      const { rows } = await client.query('select version from supabase_migrations.schema_migrations')
      applied = new Set(rows.map((row) => row.version))
    }

    const appliedNow = []
    for (const file of files) {
      const version = versionOf(file)
      const name = file.replace(/^\d+_/, '').replace(/\.sql$/, '')
      if (applied.has(version)) continue

      if (dryRun) {
        console.log(`would apply: ${file}`)
        appliedNow.push(file)
        continue
      }

      const sql = readFileSync(join(dir, file), 'utf8')
      await client.query('begin')
      try {
        await client.query(sql)
        await client.query(
          'insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)',
          [version, name, [sql]],
        )
        await client.query('commit')
        console.log(`applied: ${file}`)
        appliedNow.push(file)
      } catch (error) {
        await client.query('rollback')
        throw new Error(`Migration failed: ${file}: ${error.message}`)
      }
    }

    if (appliedNow.length === 0) console.log('Nothing to apply. Every migration is already recorded.')
    return appliedNow
  } finally {
    if (client) await client.end()
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2)
    if (args.some((arg) => arg !== '--dry-run')) throw new Error('Usage: SUPABASE_DB_URL=... node scripts/db-apply.mjs [--dry-run]')
    await applyMigrations({ dryRun: args.includes('--dry-run'), connectionString: process.env.SUPABASE_DB_URL })
  } catch (error) {
    console.error(`db-apply failed: ${error.message}`)
    process.exitCode = 1
  }
}
