// Applies unapplied files under supabase/migrations/, in order, over the
// Supabase session pooler. This is the applier that lived in the session
// scratchpad during v1 (R1.12: openness) — a committed, reproducible script
// instead of a one-off kept outside the repo.
//
// Connection: reads SUPABASE_PROJECT_REF and SUPABASE_DB_PASSWORD from
// .env.local (the same way scripts/seed-load.mjs reads its credentials) and
// builds a session-pooler connection string —
//   postgres://postgres.<ref>:<url-encoded password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres
// — because the direct host (db.<ref>.supabase.co) is IPv6-only and
// unreachable from this machine (build log 20:43). SUPABASE_DB_URL, if set,
// overrides this and is used verbatim.
//
// TLS is verified by default (rejectUnauthorized: true). If the pooler's
// certificate chain is not in Node's trust store, set
// SUPABASE_DB_SSL_CA=<path to the Supabase root CA> rather than disabling
// verification — this script refuses to silently turn verification off.
//
// `pg` is a pinned devDependency (package.json), imported dynamically only
// where it is needed so `--dry-run` still works if it is ever missing from
// a partial install.
//
// Never prints a connection string, a password, or a key.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { parseEnv } from 'node:util'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations')
const POOLER_HOST = 'aws-0-ap-south-1.pooler.supabase.com'
const POOLER_PORT = 5432
const LEDGER_MISSING = '42P01' // Postgres: relation does not exist

async function loadPg() {
  try {
    return (await import('pg')).default
  } catch {
    throw new Error('The "pg" package is not resolvable. Run `npm install` (it is a devDependency of this repo).')
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

function readEnvLocal(root) {
  try {
    return parseEnv(readFileSync(join(root, '.env.local'), 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return {}
    throw error
  }
}

/** .env.local plus any non-empty process-env override, mirroring scripts/seed-load.mjs's credentials(). */
function mergedEnv(root, env) {
  const local = readEnvLocal(root)
  const values = { ...local }
  for (const [name, value] of Object.entries(env)) {
    if (value?.trim()) values[name] = value
  }
  return values
}

export function resolveConnectionString(values) {
  if (values.SUPABASE_DB_URL?.trim()) return values.SUPABASE_DB_URL.trim()

  const ref = values.SUPABASE_PROJECT_REF?.trim()
  const password = values.SUPABASE_DB_PASSWORD?.trim()
  if (!ref || !password) {
    throw new Error(
      'Missing SUPABASE_DB_URL, or SUPABASE_PROJECT_REF + SUPABASE_DB_PASSWORD, in .env.local or the environment.',
    )
  }
  return `postgres://postgres.${ref}:${encodeURIComponent(password)}@${POOLER_HOST}:${POOLER_PORT}/postgres`
}

/** The host TLS should verify against — parsed off the actual connection
 *  string rather than the hardcoded pooler constant, so a SUPABASE_DB_URL
 *  override (a different host) still gets a matching servername. */
function targetHost(connectionString) {
  try {
    return new URL(connectionString).hostname || undefined
  } catch {
    return undefined
  }
}

function sslOptions(values, host) {
  const caPath = values.SUPABASE_DB_SSL_CA?.trim()
  // `servername` drives SNI on the way out and the SAN/hostname check on the
  // way back; without it, passing a custom `ca` can otherwise verify a chain
  // while skipping the hostname match entirely.
  const base = { rejectUnauthorized: true, servername: host }
  if (!caPath) return base
  try {
    return { ...base, ca: readFileSync(caPath, 'utf8') }
  } catch (error) {
    throw new Error(`Could not read SUPABASE_DB_SSL_CA at "${caPath}": ${error.message}`)
  }
}

async function connectOrExplain(client, values, host) {
  try {
    await client.connect()
  } catch (error) {
    const message = error.message ?? ''
    const looksLikeHostnameMismatch = error.code === 'ERR_TLS_CERT_ALTNAME_INVALID' || /altname|hostname\/ip does not match/i.test(message)
    if (looksLikeHostnameMismatch) {
      throw new Error(
        `The server's TLS certificate does not cover the host "${host}" (${message}). Confirm SUPABASE_DB_SSL_CA ` +
          'is the correct CA for this pooler, or that the connection string\'s host matches the certificate.',
      )
    }
    const looksLikeTrust = /certificate|self.signed|unable to verify|SELF_SIGNED|UNABLE_TO_VERIFY_LEAF_SIGNATURE/i.test(message)
    if (looksLikeTrust && !values.SUPABASE_DB_SSL_CA) {
      throw new Error(
        `Could not verify the server's TLS certificate (${message}). Set SUPABASE_DB_SSL_CA=<path to the ` +
          "Supabase pooler's root CA certificate> to verify against it, rather than disabling verification.",
      )
    }
    throw error
  }
}

/** Reads the applied-versions ledger. A missing table is reported loudly
 *  (never treated as "nothing has been applied yet") — planMigrations calls
 *  this before any bootstrap DDL, so a missing table means the ledger itself
 *  is missing or pointed at the wrong database, not that the project is
 *  fresh; silently returning an empty set there made a dry run list all nine
 *  migrations, including five already live, with no hint why. */
async function readLedger(client) {
  try {
    const { rows } = await client.query('select version from supabase_migrations.schema_migrations')
    return new Set(rows.map((row) => row.version))
  } catch (error) {
    if (error.code === LEDGER_MISSING) {
      throw new Error('ledger table not found; refusing to apply')
    }
    throw error
  }
}

/** Connects (read-only) and returns the list of migration files not yet recorded in the ledger. Applies nothing. */
export async function planMigrations({ root = ROOT, env = process.env } = {}) {
  const values = mergedEnv(root, env)
  const connectionString = resolveConnectionString(values)
  const host = targetHost(connectionString)
  const pg = await loadPg()
  const client = new pg.Client({ connectionString, ssl: sslOptions(values, host) })
  await connectOrExplain(client, values, host)
  try {
    const applied = await readLedger(client)
    return listMigrationFiles(join(root, 'supabase', 'migrations')).filter((file) => !applied.has(versionOf(file)))
  } finally {
    await client.end()
  }
}

/** Connects, bootstraps the ledger table if needed, and applies every pending file transactionally, in order. */
export async function applyMigrations({ root = ROOT, env = process.env } = {}) {
  const values = mergedEnv(root, env)
  const connectionString = resolveConnectionString(values)
  const host = targetHost(connectionString)
  const pg = await loadPg()
  const client = new pg.Client({ connectionString, ssl: sslOptions(values, host) })
  await connectOrExplain(client, values, host)
  try {
    await client.query(
      'create schema if not exists supabase_migrations; ' +
        'create table if not exists supabase_migrations.schema_migrations (version text not null primary key, statements text[], name text)',
    )
    const applied = await readLedger(client)
    const dir = join(root, 'supabase', 'migrations')
    const pending = listMigrationFiles(dir).filter((file) => !applied.has(versionOf(file)))

    const appliedNow = []
    for (const file of pending) {
      const version = versionOf(file)
      const name = file.replace(/^\d+_/, '').replace(/\.sql$/, '')
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
    await client.end()
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2)
    if (args.some((arg) => arg !== '--dry-run')) throw new Error('Usage: node scripts/db-apply.mjs [--dry-run]')
    if (args.includes('--dry-run')) {
      const pending = await planMigrations({})
      if (pending.length === 0) console.log('Nothing to apply. Every migration is already recorded.')
      for (const file of pending) console.log(`would apply: ${file}`)
    } else {
      await applyMigrations({})
    }
  } catch (error) {
    console.error(`db-apply failed: ${error.message}`)
    process.exitCode = 1
  }
}
