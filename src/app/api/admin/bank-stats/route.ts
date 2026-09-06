import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/gate'
import { fetchAllRows } from '@/lib/admin/paginate'
import { serviceClient } from '@/lib/supabase/server'
import type { BankStatRow, CloRef } from '@/components/admin/types'

export const runtime = 'nodejs'

// Coverage counts only: never select prompt, tests, or reference_solution here.
const EXERCISE_COLUMNS = 'clo_id, pattern, origin, verified'
const CLO_COLUMNS = 'id, ordinal, course, patterns'

interface ExerciseRow {
  clo_id: string
  pattern: string
  origin: 'seed' | 'generated'
  verified: boolean
}

export async function GET() {
  const admin = await requireAdmin()
  if (admin instanceof Response) return admin

  try {
    const svc = serviceClient()
    const [exercises, clos] = await Promise.all([
      fetchAllRows<ExerciseRow>((from, to) => svc.from('exercises').select(EXERCISE_COLUMNS).order('id').range(from, to)),
      // Service key so a banned or non-onboarded admin (exempt from is_not_banned RLS reads) still sees coverage.
      fetchAllRows<CloRef>((from, to) => svc.from('clos').select(CLO_COLUMNS).order('course').order('ordinal').range(from, to)),
    ])

    const byKey = new Map<string, BankStatRow>()
    for (const row of exercises) {
      const key = `${row.clo_id}::${row.pattern}`
      const stat = byKey.get(key) ?? { clo_id: row.clo_id, pattern: row.pattern, seed_count: 0, generated_count: 0, verified_count: 0 }
      if (row.origin === 'seed') stat.seed_count += 1
      else {
        stat.generated_count += 1
        if (row.verified) stat.verified_count += 1
      }
      byKey.set(key, stat)
    }

    return NextResponse.json({ ok: true, stats: Array.from(byKey.values()), clos })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'unable to load bank stats' }, { status: 500 })
  }
}
