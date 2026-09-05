import type { ReactNode } from 'react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getUserAndProfile, serverClient } from '@/lib/supabase/server'
import { compileLearnerState } from '@/lib/learner/compile'
import type { LearnerState } from '@/lib/contracts'
import { AppShell } from '@/components/shell/AppShell'
import { AccountNotice } from '@/components/shell/AccountNotice'
import { SessionProvider } from '@/components/shell/SessionProvider'

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await serverClient()
  const { error: liftError } = await supabase.rpc('lift_expired_restriction')
  if (liftError) throw new Error('Unable to check account access', { cause: liftError })
  const { user, profile } = await getUserAndProfile()
  if (!user) redirect('/login')
  if (!profile) throw new Error('Unable to load your profile')
  // Cookie mutation is forbidden during rendering. This handler verifies the ban and clears cookies.
  if (profile.account_status === 'banned') redirect('/auth/signout')
  const pathname = (await headers()).get('x-brogram-pathname') ?? ''
  if (profile.account_status === 'restricted' && /^\/exercise(?:\/|$)/.test(pathname)) redirect('/dashboard')

  const { data: row, error } = await supabase.from('learner_state').select('state, version').eq('user_id', user.id).maybeSingle()
  if (error) throw new Error('Unable to load your learning progress', { cause: error })
  // Do not recompile a saved document from empty history: that would erase points, streaks and integrity.
  const learnerState: LearnerState = row?.state
    ? { ...row.state, userId: user.id, accountStatus: profile.account_status, version: row.version }
    : compileLearnerState(profile, [], [], [], null)

  return (
    <SessionProvider key={`${user.id}:${profile.account_status}:${profile.restricted_until}`} initialState={{ user, profile, learnerState }}>
      <AccountNotice status={profile.account_status} restrictedUntil={profile.restricted_until} />
      <AppShell>{children}</AppShell>
    </SessionProvider>
  )
}
