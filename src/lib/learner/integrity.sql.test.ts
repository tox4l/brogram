import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { INTEGRITY_WEIGHTS } from '@/lib/contracts'

// There is no test asserting INTEGRITY_WEIGHTS equals the SQL weights (spec
// C2 / R11.2): the old inlined `case` expression in 0003_integrity.sql was
// replaced by a table in 0008_integrity_breakdown.sql, and this is the test
// that keeps the two sources from drifting apart. It reads the migration's
// own SQL rather than hitting a database, so it runs in the normal unit
// suite with no live project required.
const here = dirname(fileURLToPath(import.meta.url))
const migrationPath = join(here, '..', '..', '..', 'supabase', 'migrations', '0008_integrity_breakdown.sql')
const sql = readFileSync(migrationPath, 'utf8')

/** Strips `--` line comments so a comment that merely talks about a `case`
 *  expression (as this file's own header does, describing the bug it fixes)
 *  is never mistaken for a real one. */
function stripLineComments(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
}

function parseWeightTuples(text: string): Record<string, number> {
  const match = text.match(/insert into public\.integrity_weights\s*\(type, weight\)\s*values\s*([\s\S]*?);/)
  if (!match) throw new Error('could not find the integrity_weights insert statement in 0008_integrity_breakdown.sql')
  const weights: Record<string, number> = {}
  const tupleRe = /\(\s*'([^']+)'\s*,\s*(\d+)\s*\)/g
  for (const tuple of match[1].matchAll(tupleRe)) {
    weights[tuple[1]] = Number(tuple[2])
  }
  return weights
}

describe('0008_integrity_breakdown.sql weights', () => {
  it('seeds integrity_weights with exactly the INTEGRITY_WEIGHTS contract, key for key and number for number', () => {
    const sqlWeights = parseWeightTuples(sql)
    expect(sqlWeights).toEqual(INTEGRITY_WEIGHTS)
  })

  it('has no second case expression over event types — the table is the only place the weights live', () => {
    const codeOnly = stripLineComments(sql)
    expect(codeOnly).not.toMatch(/\bcase\b[\s\S]*?\bwhen\b/i)
  })
})
