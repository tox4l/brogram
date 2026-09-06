import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
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

  const { data: existingInvite, error: existingInviteError } = await svc
    .from('invites')
    .select('email, redeemed_at')
    .eq('email', email)
    .maybeSingle()
  if (existingInviteError) {
    return NextResponse.json({ ok: false, error: existingInviteError.message }, { status: 500 })
  }
  // A redeemed invite means the trigger already saw an auth.users row for this email.
  if (existingInvite && existingInvite.redeemed_at) {
    return NextResponse.json({ ok: false, error: 'an account for this email already exists' }, { status: 409 })
  }
  // Only clean up on failure if this call is the one that created the row; a
  // pre-existing unredeemed invite (e.g. minted via /api/admin/invites) is left alone.
  const inviteExistedBeforehand = existingInvite !== null

  // Upsert the invite BEFORE creating the auth user: handle_new_user redeems a matching
  // unredeemed invite as soon as the auth.users row lands, so the invite must exist first.
  const { error: upsertError } = await svc.from('invites').upsert(
    { code: randomUUID(), email, created_by: admin.user.id, redeemed_at: null, redeemed_by: null },
    { onConflict: 'email' },
  )
  if (upsertError) {
    return NextResponse.json({ ok: false, error: upsertError.message }, { status: 500 })
  }

  const { data, error } = await svc.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: displayName ? { display_name: displayName } : {},
  })

  if (error || !data.user) {
    if (!inviteExistedBeforehand) {
      await svc.from('invites').delete().eq('email', email)
    }
    const status = error?.code === 'email_exists' || error?.code === 'user_already_exists' ? 409 : 500
    return NextResponse.json({ ok: false, error: error?.message ?? 'unable to create account' }, { status })
  }

  return NextResponse.json({ ok: true, id: data.user.id, email: data.user.email }, { status: 201 })
}
