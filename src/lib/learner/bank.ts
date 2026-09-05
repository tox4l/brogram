import type { SupabaseClient } from '@supabase/supabase-js'
import type { BankQuery, Difficulty, ExerciseKind, ExercisePublic, Language, TestCase } from '@/lib/contracts'

/** The one table clients may read. The bank table itself is never selectable from a browser. */
export const BANK_VIEW = 'exercises_public'

/** Everyone starts at difficulty 3 (spec section 7.2). */
export const DEFAULT_DIFFICULTY: Difficulty = 3

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function list<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function asDifficulty(value: unknown): Difficulty {
  const n = typeof value === 'number' ? Math.round(value) : Number.NaN
  if (!Number.isFinite(n)) return DEFAULT_DIFFICULTY
  return Math.min(5, Math.max(1, n)) as Difficulty
}

/** A snake_case `exercises_public` row as the contract shape. Every bank select goes through this. */
export function toExercisePublic(row: Record<string, unknown>): ExercisePublic {
  const exercise: ExercisePublic = {
    id: text(row.id),
    cloId: text(row.clo_id),
    language: text(row.language) as Language,
    kind: text(row.kind) as ExerciseKind,
    difficulty: asDifficulty(row.difficulty),
    pattern: text(row.pattern),
    title: text(row.title),
    prompt: text(row.prompt),
    starterCode: text(row.starter_code),
    tests: list<TestCase>(row.tests),
    origin: row.origin === 'generated' ? 'generated' : 'seed',
    tags: list<string>(row.tags),
  }

  if (typeof row.parent_exercise_id === 'string' && row.parent_exercise_id) exercise.parentExerciseId = row.parent_exercise_id
  if (typeof row.fixture === 'string' && row.fixture) exercise.fixture = row.fixture

  return exercise
}

/**
 * The widening chain from spec section 7.1, in memory:
 * preferred patterns at the target difficulty plus or minus 1, then any pattern
 * at plus or minus 1, then plus or minus 2, then anything unseen on the CLO.
 * Excluded ids, excluded patterns and the language filter apply at every tier.
 * Null means the CLO is exhausted, which is the only thing that may trigger `bank-miss`.
 */
export function pickFromBank(query: BankQuery, rows: ExercisePublic[]): ExercisePublic | null {
  const target = query.difficulty ?? DEFAULT_DIFFICULTY
  const prefer = new Set(query.preferPatterns ?? [])
  const excludedIds = new Set(query.excludeExerciseIds ?? [])
  const excludedPatterns = new Set(query.excludePatterns ?? [])

  const unseen = rows.filter(
    (row) =>
      row.cloId === query.cloId &&
      !excludedIds.has(row.id) &&
      !excludedPatterns.has(row.pattern) &&
      (query.language === undefined || row.language === query.language),
  )

  const near = (row: ExercisePublic, span: number) => Math.abs(row.difficulty - target) <= span
  const tiers: ((row: ExercisePublic) => boolean)[] = [
    (row) => prefer.has(row.pattern) && near(row, 1),
    (row) => near(row, 1),
    (row) => near(row, 2),
    () => true,
  ]

  for (const tier of tiers) {
    const candidates = unseen.filter(tier)
    if (candidates.length === 0) continue
    return candidates.reduce((best, row) => (Math.abs(row.difficulty - target) < Math.abs(best.difficulty - target) ? row : best))
  }

  return null
}

/** Reads the bank view for one CLO. The widening happens in `pickFromBank`, on the rows this returns. */
export async function fetchBank(supabase: SupabaseClient, query: BankQuery): Promise<ExercisePublic[]> {
  const { data, error } = await supabase.from(BANK_VIEW).select('*').eq('clo_id', query.cloId)
  if (error) throw new Error(`bank query failed: ${error.message}`)
  return (data ?? []).map((row: Record<string, unknown>) => toExercisePublic(row))
}
