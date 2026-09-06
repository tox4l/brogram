import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/gate'
import { serviceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const MIN_PASSWORD_LENGTH = 8

interface CreateAccountBody {
  email?: unknown
  password?: unknown
  displayName?: unknown
}

export async function POST(req: Request) {
  const admin = await requireAdmin()
  if (admin instanceof Response) return admin

  const body = (await req.json().catch(() => null)) as CreateAccountBody | null
  const rawEmail = typeof body?.email === 'string' ? body.email : ''
  const email = rawEmail.trim().toLowerCase()
  const password = typeof body?.password === 'string' ? body.password : ''
  const rawDisplayName = typeof body?.displayName === 'string' ? body.displayName : ''
  const displayName = rawDisplayName.trim()

  if (!email || !email.includes('@')) {
    return NextResponse.json({ ok: false, error: 'email must be a valid address' }, { status: 400 })
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json({ ok: false, error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` }, { status: 400 })
  }

  const svc = serviceClient()
  const { data, error } = await svc.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: displayName ? { display_name: displayName } : {},
  })

  if (error || !data.user) {
    const status = error?.code === 'email_exists' || error?.code === 'user_already_exists' ? 409 : 500
    return NextResponse.json({ ok: false, error: error?.message ?? 'unable to create account' }, { status })
  }

  // Admin-issued accounts skip the invite-redemption flow entirely; this row exists only
  // so the redemption gate hook still finds a record for the email.
  const { error: inviteError } = await svc.from('invites').insert({
    code: crypto.randomUUID(),
    email,
    created_by: admin.user.id,
    redeemed_by: data.user.id,
    redeemed_at: new Date().toISOString(),
  })
  if (inviteError) {
    return NextResponse.json({ ok: false, error: inviteError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, id: data.user.id, email: data.user.email }, { status: 201 })
}
