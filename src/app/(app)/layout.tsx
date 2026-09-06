import type { ReactNode } from 'react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { serverClient } from '@/lib/supabase/server'
import { compileLearnerState } from '@/lib/learner/compile'
import type { AccountStatus, LearnerState } from '@/lib/contracts'
import { AppShell } from '@/components/shell/AppShell'
import { AccountNotice } from '@/components/shell/AccountNotice'
import { SessionProvider } from '@/components/shell/SessionProvider'

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await serverClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) redirect('/login')
  const requestHeaders = await headers()
  const status = requestHeaders.get('x-brogram-account-status')
  if (!status || !['active', 'warned', 'restricted', 'banned'].includes(status)) throw new Error('Unable to load your profile')
  const profile = { id: user.id, account_status: status as AccountStatus, restricted_until: requestHeaders.get('x-brogram-restricted-until') || null }
  // Cookie mutation is forbidden during rendering. This handler verifies the ban and clears cookies.
  if (profile.account_status === 'banned') redirect('/auth/signout')
  const pathname = requestHeaders.get('x-brogram-pathname') ?? ''
  if (profile.account_status === 'restricted' && /^\/exercise(?:\/|$)/.test(pathname)) redirect('/dashboard')

  const { data: row, error } = await supabase.from('learner_state').select('state, version').eq('user_id', user.id).maybeSingle()
  if (error) throw new Error('Unable to load your learning progress', { cause: error })
  const now = new Date()
  const document = row?.state
  const record = (value: unknown) => value !== null && typeof value === 'object' && !Array.isArray(value)
  const saved: LearnerState | null = record(document) && record(document.profile) &&
    record(document.streak) && record(document.mastery) ? document : null
  let learnerState = compileLearnerState(profile, [], [], [], null, undefined, now)
  if (saved) {
    // The frozen compiler derives dates from history, not prev. Keep cached aggregates,
    // and supply date-only history so a returning learner cannot keep an expired streak.
    async function activityDates() {
      const dates: { created_at: string }[] = []
      for (let offset = 0; ; offset += 1000) {
        const page = await supabase.from('attempts').select('created_at').eq('user_id', user!.id)
          .order('created_at', { ascending: false }).range(offset, offset + 999)
        if (page.error) throw new Error('Unable to refresh your activity dates', { cause: page.error })
        dates.push(...(page.data ?? []))
        if ((page.data?.length ?? 0) < 1000) return dates
      }
    }
    const [attempts, wellness] = await Promise.all([
      activityDates(),
      supabase.from('wellness').select('drill_results').eq('user_id', user.id).maybeSingle(),
    ])
    if (wellness.error) throw new Error('Unable to refresh your activity dates', { cause: wellness.error })
    const refreshed = compileLearnerState(profile, [], attempts.map((attempt) => ({
      exercise_id: '', passed: false, created_at: attempt.created_at,
    })), [], wellness.data, saved, now)
    learnerState = { ...learnerState, ...saved, profile: refreshed.profile, streak: {
      ...refreshed.streak,
      lastExerciseDate: refreshed.streak.lastExerciseDate ?? saved.streak.lastExerciseDate ?? null,
      lastDerotDate: refreshed.streak.lastDerotDate ?? saved.streak.lastDerotDate ?? null,
    }, updatedAt: refreshed.updatedAt }
  }
  learnerState = { ...learnerState, userId: user.id, accountStatus: profile.account_status, version: row?.version ?? 0 }

  return (
    <SessionProvider key={`${user.id}:${profile.account_status}:${profile.restricted_until}`} initialState={{ user, profile, learnerState }}>
      <AccountNotice status={profile.account_status} restrictedUntil={profile.restricted_until} />
      <AppShell>{children}</AppShell>
    </SessionProvider>
  )
}
