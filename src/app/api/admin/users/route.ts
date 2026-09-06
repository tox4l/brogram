import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/gate'
import { serviceClient } from '@/lib/supabase/server'
import { INTEGRITY_THRESHOLDS, INTEGRITY_WEIGHTS, type IntegrityEventType } from '@/lib/contracts'
import type { UserRow } from '@/components/admin/types'

export const runtime = 'nodejs'

interface ProfileRow {
  id: string
  display_name: string
  account_status: UserRow['account_status']
  restricted_until: string | null
  created_at: string
  last_seen_at: string
}

/** auth.users is not exposed as a queryable table to the service key; list it through the admin API. */
async function loadEmails(svc: ReturnType<typeof serviceClient>): Promise<Map<string, string | null>> {
  const emails = new Map<string, string | null>()
  const perPage = 200
  for (let page = 1; ; page += 1) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage })
    if (error) throw new Error('Unable to load auth users', { cause: error })
    for (const user of data.users) emails.set(user.id, user.email ?? null)
    if (data.users.length < perPage) break
  }
  return emails
}

export async function GET() {
  const admin = await requireAdmin()
  if (admin instanceof Response) return admin

  const svc = serviceClient()
  const [profilesResult, emails] = await Promise.all([
    svc.from('profiles').select('id, display_name, account_status, restricted_until, created_at, last_seen_at'),
    loadEmails(svc),
  ])
  if (profilesResult.error) return NextResponse.json({ ok: false, error: profilesResult.error.message }, { status: 500 })

  // Score and event counts are a SQL-free aggregation over the last 7 days, computed here
  // with the contracts' INTEGRITY_WEIGHTS rather than one integrity_score() rpc call per user.
  const since = new Date(Date.now() - INTEGRITY_THRESHOLDS.windowDays * 24 * 60 * 60 * 1000).toISOString()
  const { data: events, error: eventsError } = await svc
    .from('integrity_events')
    .select('user_id, type')
    .gte('created_at', since)
  if (eventsError) return NextResponse.json({ ok: false, error: eventsError.message }, { status: 500 })

  const eventCountsByUser = new Map<string, Partial<Record<IntegrityEventType, number>>>()
  const scoreByUser = new Map<string, number>()
  for (const event of events ?? []) {
    const type = event.type as IntegrityEventType
    const counts = eventCountsByUser.get(event.user_id) ?? {}
    counts[type] = (counts[type] ?? 0) + 1
    eventCountsByUser.set(event.user_id, counts)
    scoreByUser.set(event.user_id, (scoreByUser.get(event.user_id) ?? 0) + (INTEGRITY_WEIGHTS[type] ?? 0))
  }

  const profiles = (profilesResult.data ?? []) as ProfileRow[]
  const users: UserRow[] = profiles.map((profile) => ({
    id: profile.id,
    display_name: profile.display_name,
    email: emails.get(profile.id) ?? null,
    account_status: profile.account_status,
    restricted_until: profile.restricted_until,
    integrity_score: scoreByUser.get(profile.id) ?? 0,
    event_counts: eventCountsByUser.get(profile.id) ?? {},
    last_seen_at: profile.last_seen_at,
    created_at: profile.created_at,
  }))

  return NextResponse.json({ ok: true, users })
}
