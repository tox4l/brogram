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
const migrationsDir = join(here, '..', '..', '..', 'supabase', 'migrations')
const sql = readFileSync(join(migrationsDir, '0008_integrity_breakdown.sql'), 'utf8')
const sql0003 = readFileSync(join(migrationsDir, '0003_integrity.sql'), 'utf8')
const sql0009 = readFileSync(join(migrationsDir, '0009_drill_lanes.sql'), 'utf8')

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

/** 0003's inlined `case type when '...' then N ... else 0 end` — superseded
 *  at runtime by 0008's `create or replace function integrity_score`, but
 *  the file is not deleted (migrations are immutable once applied) and its
 *  numbers must not silently drift from the table that now actually runs. */
function parseCaseWeights(text: string, keys: string[]): Record<string, number> {
  const weights: Record<string, number> = {}
  for (const key of keys) weights[key] = 0
  const tupleRe = /when\s+'([^']+)'\s+then\s+(\d+)/g
  for (const tuple of text.matchAll(tupleRe)) {
    weights[tuple[1]] = Number(tuple[2])
  }
  return weights
}

function policyDefinition(text: string, policyName: string): string {
  const match = text.match(new RegExp(`create policy ${policyName}\\b[\\s\\S]*?;`))
  if (!match) throw new Error(`could not find policy ${policyName}`)
  return match[0]
}

function functionBody(text: string, functionName: string): string {
  const match = text.match(new RegExp(`create or replace function public\\.${functionName}\\([\\s\\S]*?\\$\\$;`))
  if (!match) throw new Error(`could not find function ${functionName}`)
  return match[0]
}

describe('0008_integrity_breakdown.sql weights', () => {
  it('seeds integrity_weights with exactly the INTEGRITY_WEIGHTS contract, key for key and number for number', () => {
    const sqlWeights = parseWeightTuples(sql)
    expect(sqlWeights).toEqual(INTEGRITY_WEIGHTS)
  })

  it('has no second case expression over event types in 0008 — the table is the only place the weights live', () => {
    const codeOnly = stripLineComments(sql)
    expect(codeOnly).not.toMatch(/\bcase\b[\s\S]*?\bwhen\b/i)
  })

  it('the superseded case expression left in 0003_integrity.sql still agrees with the same numbers', () => {
    // Dead code at runtime (0008's `create or replace` wins), but a second
    // written copy of the numbers exists in the tree and must not drift.
    expect(parseCaseWeights(sql0003, Object.keys(INTEGRITY_WEIGHTS))).toEqual(INTEGRITY_WEIGHTS)
  })

  it('integrity_weights_read is not role-restricted to "authenticated" (C1)', () => {
    // integrity_score() is invoker-rights and its only caller,
    // apply_integrity_escalation(), is `security definer` — it runs as ITS
    // OWNER, not as `authenticated`. A `to authenticated` policy would hide
    // every row from that definer function whenever the owner role differs,
    // silently zeroing every learner's score. The policy must apply to
    // every role (no `to <role>` clause at all).
    const policy = policyDefinition(sql, 'integrity_weights_read')
    expect(policy).not.toMatch(/\bto\s+authenticated\b/i)
    expect(policy).toMatch(/for select\s+using\s*\(true\)/i)
  })
})

describe('0009_drill_lanes.sql append_drill_result required fields', () => {
  // `result->>'x'` is SQL NULL for both a missing key and an explicit JSON
  // null, and `NULL::timestamptz` is NULL (not an error) and `trim(NULL) = ''`
  // is NULL (not true) — so a cast-only or trim-only guard lets a bare
  // `{"drillId": null}` or an absent/null `at` slip through silently. Both
  // fields need an explicit `is null` check before the value is used.
  const body = functionBody(sql0009, 'append_drill_result')

  it('rejects a missing or null "at" before ever attempting the timestamp cast', () => {
    const requiredCheck = /if\s+not\s*\(result\s*\?\s*'at'\)\s+or\s+result->>'at'\s+is\s+null\s+then\s+raise exception/i
    expect(body).toMatch(requiredCheck)

    const requiredIndex = body.search(requiredCheck)
    const castIndex = body.search(/perform\s*\(result->>'at'\)::timestamptz/i)
    expect(requiredIndex).toBeGreaterThan(-1)
    expect(castIndex).toBeGreaterThan(-1)
    expect(requiredIndex).toBeLessThan(castIndex)
  })

  it('rejects a null "drillId", not just a missing key or an empty string', () => {
    expect(body).toMatch(/if\s+not\s*\(result\s*\?\s*'drillId'\)\s+or\s+result->>'drillId'\s+is\s+null\s+or\s+trim\(result->>'drillId'\)\s*=\s*''\s+then/i)
  })
})
