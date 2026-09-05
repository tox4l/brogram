/**
 * Row shapes for the admin tables. These are presentation-only contracts: the
 * wiring lane (Astra) maps Supabase rows straight onto these shapes and passes
 * them in as props. snake_case mirrors the Postgres tables in spec section 4
 * on purpose so no field renaming has to happen at the boundary.
 */

import type { AccountStatus, AgentName, CloId, IntegrityEventType, PatternId } from '@/lib/contracts'

export interface InviteRow {
  code: string
  email: string
  created_at: string
  redeemed_at: string | null
  redeemed_by: string | null
}

export interface UserRow {
  id: string
  display_name: string
  email: string | null
  account_status: AccountStatus
  restricted_until: string | null
  integrity_score: number
  event_counts: Partial<Record<IntegrityEventType, number>>
  last_seen_at: string
  created_at: string
}

export interface BankStatRow {
  clo_id: CloId
  pattern: PatternId
  seed_count: number
  generated_count: number
  verified_count: number
}

export interface AgentUsageRow {
  day: string
  agent: AgentName
  calls: number
  fallback_calls: number
  prompt_tokens: number
  completion_tokens: number
  cache_hit_tokens: number
}

/** The CLO reference BankStatsTable needs to group and order rows; it does not need the full Clo shape. */
export interface CloRef {
  id: CloId
  ordinal: number
  course: string
  patterns: PatternId[]
}
