import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/gate'
import { serviceClient } from '@/lib/supabase/server'
import type { BankStatRow } from '@/components/admin/types'

export const runtime = 'nodejs'

// Coverage counts only: never select prompt, tests, or reference_solution here.
const EXERCISE_COLUMNS = 'clo_id, pattern, origin, verified'

interface ExerciseRow {
  clo_id: string
  pattern: string
  origin: 'seed' | 'generated'
  verified: boolean
}

export async function GET() {
  const admin = await requireAdmin()
  if (admin instanceof Response) return admin

  const { data, error } = await serviceClient().from('exercises').select(EXERCISE_COLUMNS)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  const byKey = new Map<string, BankStatRow>()
  for (const row of (data ?? []) as ExerciseRow[]) {
    const key = `${row.clo_id}::${row.pattern}`
    const stat = byKey.get(key) ?? { clo_id: row.clo_id, pattern: row.pattern, seed_count: 0, generated_count: 0, verified_count: 0 }
    if (row.origin === 'seed') stat.seed_count += 1
    else {
      stat.generated_count += 1
      if (row.verified) stat.verified_count += 1
    }
    byKey.set(key, stat)
  }

  return NextResponse.json({ ok: true, stats: Array.from(byKey.values()) })
}
