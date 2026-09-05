import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { User } from '@supabase/supabase-js'
import { afterEach, describe, expect, it } from 'vitest'
import { compileLearnerState } from '@/lib/learner/compile'
import { SessionProvider } from '@/components/shell/SessionProvider'
import { useSession } from './session'

afterEach(cleanup)

function Reader() {
  const { user, learnerState, setLearnerState } = useSession()
  return <button onClick={() => setLearnerState({ ...learnerState!, points: 42 })}>{user?.id}: {learnerState?.points}</button>
}

describe('session ownership', () => {
  it('keeps simultaneous providers isolated and publishes learner updates to subscribers', () => {
    const state = (id: string) => ({
      user: { id } as User,
      profile: { id, account_status: 'active' as const, restricted_until: null },
      learnerState: compileLearnerState({ id }, [], [], [], null),
    })
    render(<><SessionProvider initialState={state('first')}><Reader /></SessionProvider><SessionProvider initialState={state('second')}><Reader /></SessionProvider></>)
    fireEvent.click(screen.getByRole('button', { name: 'first: 0' }))
    expect(screen.getByRole('button', { name: 'first: 42' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'second: 0' })).toBeTruthy()
  })

  it('accepts newer server revisions after a refresh and preserves newer in-memory progress', () => {
    const initial = {
      user: { id: 'student' } as User,
      profile: { id: 'student', account_status: 'active' as const, restricted_until: null },
      learnerState: compileLearnerState({ id: 'student' }, [], [], [], null),
    }
    const { rerender } = render(<SessionProvider initialState={initial}><Reader /></SessionProvider>)
    rerender(<SessionProvider initialState={{ ...initial, learnerState: { ...initial.learnerState, version: 3, points: 900 } }}><Reader /></SessionProvider>)
    expect(screen.getByRole('button', { name: 'student: 900' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'student: 900' }))
    rerender(<SessionProvider initialState={{ ...initial, learnerState: { ...initial.learnerState, version: 2, points: 100 } }}><Reader /></SessionProvider>)
    expect(screen.getByRole('button', { name: 'student: 42' })).toBeTruthy()
  })
})
