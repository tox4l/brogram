import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { requireAdmin } from '@/lib/admin/gate'
import { serviceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const INVITE_DOMAIN_SUFFIX = '.edu.qa'
const INVITE_COLUMNS = 'code, email, created_at, redeemed_at, redeemed_by'

export async function GET() {
  const admin = await requireAdmin()
  if (admin instanceof Response) return admin

  const { data, error } = await serviceClient()
    .from('invites')
    .select(INVITE_COLUMNS)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, invites: data ?? [] })
}

export async function POST(req: Request) {
  const admin = await requireAdmin()
  if (admin instanceof Response) return admin

  const body = (await req.json().catch(() => null)) as { email?: unknown } | null
  const raw = typeof body?.email === 'string' ? body.email : ''
  const email = raw.trim().toLowerCase()
  if (!email || !email.endsWith(INVITE_DOMAIN_SUFFIX)) {
    return NextResponse.json({ ok: false, error: `email must end with ${INVITE_DOMAIN_SUFFIX}` }, { status: 400 })
  }

  const code = randomUUID()
  const { data, error } = await serviceClient()
    .from('invites')
    .insert({ code, email, created_by: admin.user.id })
    .select(INVITE_COLUMNS)
    .single()

  if (error) {
    // unique_violation on invites.email
    if (error.code === '23505') return NextResponse.json({ ok: false, error: 'an invite for this email already exists' }, { status: 409 })
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, invite: data }, { status: 201 })
}
