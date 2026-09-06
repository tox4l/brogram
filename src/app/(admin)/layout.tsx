import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { getUserAndProfile } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin/gate'

/**
 * Gates every route under the (admin) group, not just /admin: a signed-in
 * non-admin (or signed-out visitor) gets the same 404 as a route that does
 * not exist, so the whole surface stays invisible.
 */
export default async function AdminGroupLayout({ children }: { children: ReactNode }) {
  const { user } = await getUserAndProfile()
  if (!isAdmin(user?.id)) notFound()
  return children
}
