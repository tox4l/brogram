import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/gate'
import { serviceClient } from '@/lib/supabase/server'
import type { AgentName } from '@/lib/contracts'
import type { AgentUsageRow } from '@/components/admin/types'

export const runtime = 'nodejs'
const WINDOW_DAYS = 14

interface UsageRow {
  agent: AgentName
  prompt_tokens: number
  completion_tokens: number
  cache_hit_tokens: number
  fallback: boolean
  created_at: string
}

/** created_at is a timestamptz ISO string; the calendar day is its first 10 characters (UTC). */
function dayOf(createdAt: string): string {
  return createdAt.slice(0, 10)
}

export async function GET() {
  const admin = await requireAdmin()
  if (admin instanceof Response) return admin

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await serviceClient()
    .from('agent_usage')
    .select('agent, prompt_tokens, completion_tokens, cache_hit_tokens, fallback, created_at')
    .gte('created_at', since)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  const byKey = new Map<string, AgentUsageRow>()
  for (const row of (data ?? []) as UsageRow[]) {
    const day = dayOf(row.created_at)
    const key = `${day}::${row.agent}`
    const stat = byKey.get(key) ?? { day, agent: row.agent, calls: 0, fallback_calls: 0, prompt_tokens: 0, completion_tokens: 0, cache_hit_tokens: 0 }
    stat.calls += 1
    if (row.fallback) stat.fallback_calls += 1
    stat.prompt_tokens += row.prompt_tokens ?? 0
    stat.completion_tokens += row.completion_tokens ?? 0
    stat.cache_hit_tokens += row.cache_hit_tokens ?? 0
    byKey.set(key, stat)
  }

  return NextResponse.json({ ok: true, usage: Array.from(byKey.values()) })
}
