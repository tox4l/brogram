import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/gate'
import { fetchAllRows } from '@/lib/admin/paginate'
import { serviceClient } from '@/lib/supabase/server'
import { INTEGRITY_THRESHOLDS, INTEGRITY_WEIGHTS, type IntegrityEventType } from '@/lib/contracts'
import type { UserRow } from '@/components/admin/types'

export const runtime = 'nodejs'

const PROFILE_COLUMNS = 'id, display_name, account_status, restricted_until, created_at, last_seen_at'
// The database's integrity_score(uid) is the source of truth (the escalation trigger uses the
// same function); a JS sum over INTEGRITY_WEIGHTS is kept only as a fallback if the rpc errors.
const RPC_CHUNK_SIZE = 50

interface ProfileRow {
  id: string
  display_name: string
  account_status: UserRow['account_status']
  restricted_until: string | null
  created_at: string
  last_seen_at: string
}

interface EventRow {
  user_id: string
  type: IntegrityEventType
}

type ServiceClient = ReturnType<typeof serviceClient>

/** auth.users is not exposed as a queryable table to the service key; list it through the admin API. */
async function loadEmails(svc: ServiceClient): Promise<Map<string, string | null>> {
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

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

interface ScoreResult {
  score: number
  fallback: boolean
}

/** One integrity_score(uid) rpc per user, chunked so a large cohort never fires hundreds of calls at once. */
async function scoreProfiles(
  svc: ServiceClient,
  ids: string[],
  fallbackScores: Map<string, number>,
): Promise<Map<string, ScoreResult>> {
  const scores = new Map<string, ScoreResult>()
  for (const group of chunk(ids, RPC_CHUNK_SIZE)) {
    const settled = await Promise.all(
      group.map(async (id) => {
        const { data, error } = await svc.rpc('integrity_score', { uid: id })
        return { id, data, error }
      }),
    )
    for (const { id, data, error } of settled) {
      if (error || typeof data !== 'number') {
        scores.set(id, { score: fallbackScores.get(id) ?? 0, fallback: true })
      } else {
        scores.set(id, { score: data, fallback: false })
      }
    }
  }
  return scores
}

export async function GET() {
  const admin = await requireAdmin()
  if (admin instanceof Response) return admin

  const svc = serviceClient()
  try {
    const [profiles, emails, events] = await Promise.all([
      fetchAllRows<ProfileRow>((from, to) => svc.from('profiles').select(PROFILE_COLUMNS).order('id').range(from, to)),
      loadEmails(svc),
      fetchAllRows<EventRow>((from, to) => {
        const since = new Date(Date.now() - INTEGRITY_THRESHOLDS.windowDays * 24 * 60 * 60 * 1000).toISOString()
        return svc.from('integrity_events').select('user_id, type').gte('created_at', since).order('id').range(from, to)
      }),
    ])

    // event_counts stays a JS aggregation (there is no per-type rpc); it also feeds the
    // fallback score used only when integrity_score(uid) itself errors for a user.
    const eventCountsByUser = new Map<string, Partial<Record<IntegrityEventType, number>>>()
    const fallbackScores = new Map<string, number>()
    for (const event of events) {
      const counts = eventCountsByUser.get(event.user_id) ?? {}
      counts[event.type] = (counts[event.type] ?? 0) + 1
      eventCountsByUser.set(event.user_id, counts)
      fallbackScores.set(event.user_id, (fallbackScores.get(event.user_id) ?? 0) + (INTEGRITY_WEIGHTS[event.type] ?? 0))
    }

    const scores = await scoreProfiles(svc, profiles.map((p) => p.id), fallbackScores)

    const users: Array<UserRow & { score_source?: 'fallback' }> = profiles.map((profile) => {
      const scored = scores.get(profile.id) ?? { score: fallbackScores.get(profile.id) ?? 0, fallback: true }
      return {
        id: profile.id,
        display_name: profile.display_name,
        email: emails.get(profile.id) ?? null,
        account_status: profile.account_status,
        restricted_until: profile.restricted_until,
        integrity_score: scored.score,
        event_counts: eventCountsByUser.get(profile.id) ?? {},
        last_seen_at: profile.last_seen_at,
        created_at: profile.created_at,
        ...(scored.fallback ? { score_source: 'fallback' as const } : {}),
      }
    })

    return NextResponse.json({ ok: true, users })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'unable to load users' }, { status: 500 })
  }
}
