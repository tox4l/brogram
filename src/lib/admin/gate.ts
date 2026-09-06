import { NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { getUserAndProfile } from '@/lib/supabase/server'

/**
 * The whole admin surface is invisible to non-admins: every /api/admin/*
 * handler and the /admin layout answer 404, never 401 or 403, so a
 * signed-in student cannot tell the surface exists at all.
 */
export function isAdmin(userId: string | null | undefined): boolean {
  const ids = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return !!userId && ids.length > 0 && ids.includes(userId)
}

/** Route handlers call this first; a non-2xx result is always the 404 to return as-is. */
export async function requireAdmin(): Promise<{ user: User } | Response> {
  const { user } = await getUserAndProfile()
  if (!isAdmin(user?.id)) return new NextResponse(null, { status: 404 })
  return { user: user as User }
}
