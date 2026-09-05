import { NextResponse } from 'next/server'
import { getUserAndProfile, serviceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/** The author's browser ran the reference against the tests; this marks the generated row usable. */
export async function POST(req: Request) {
  const { user } = await getUserAndProfile()
  if (!user) return NextResponse.json({ ok: false, error: 'not signed in' }, { status: 401 })
  const body = (await req.json().catch(() => null)) as { id?: unknown } | null
  const id = body?.id
  if (typeof id !== 'string' || !id) return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 })

  const { data } = await serviceClient()
    .from('exercises')
    .update({ verified: true })
    .eq('id', id)
    .eq('author_user_id', user.id)
    .select('id')
  if (!data?.length) return NextResponse.json({ ok: false, error: 'no exercise of yours with that id' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
