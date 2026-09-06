import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/gate'
import { serviceClient } from '@/lib/supabase/server'
import { INTEGRITY_THRESHOLDS } from '@/lib/contracts'

export const runtime = 'nodejs'

const ACTIONS = ['lift', 'restrict', 'ban'] as const
type Action = (typeof ACTIONS)[number]

function isAction(value: unknown): value is Action {
  return typeof value === 'string' && (ACTIONS as readonly string[]).includes(value)
}

function patchFor(action: Action): Record<string, unknown> {
  if (action === 'lift') return { account_status: 'active', restricted_until: null }
  if (action === 'restrict') {
    return {
      account_status: 'restricted',
      restricted_until: new Date(Date.now() + INTEGRITY_THRESHOLDS.restrictHours * 60 * 60 * 1000).toISOString(),
    }
  }
  return { account_status: 'banned' }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin()
  if (admin instanceof Response) return admin

  const { id } = await params
  const body = (await req.json().catch(() => null)) as { action?: unknown } | null
  if (!isAction(body?.action)) {
    return NextResponse.json({ ok: false, error: 'action must be lift, restrict, or ban' }, { status: 400 })
  }

  const patch = patchFor(body.action)
  const { error } = await serviceClient().from('profiles').update(patch).eq('id', id)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
