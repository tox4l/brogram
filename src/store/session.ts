'use client'

import { createContext, useContext } from 'react'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { User } from '@supabase/supabase-js'
import type { AccountStatus, LearnerState } from '@/lib/contracts'

export interface SessionProfile {
  id: string
  account_status: AccountStatus
  restricted_until: string | null
}

export interface SessionData {
  user: User | null
  profile: SessionProfile | null
  learnerState: LearnerState | null
}

export interface Session extends SessionData {
  setLearnerState: (learnerState: LearnerState) => void
}

export function createSessionStore(initialState: SessionData) {
  return createStore<Session>()((set) => ({
    ...initialState,
    setLearnerState: (learnerState) => set((session) => {
      if (learnerState.userId !== session.user?.id) throw new Error('Learner state belongs to another user')
      return { learnerState }
    }),
  }))
}

export const SessionContext = createContext<StoreApi<Session> | null>(null)
const identity = (session: Session) => session

export function useSession(): Session
export function useSession<T>(selector: (session: Session) => T): T
export function useSession<T>(selector?: (session: Session) => T): T | Session {
  const store = useContext(SessionContext)
  if (!store) throw new Error('useSession requires SessionProvider')
  return useStore(store, selector ?? (identity as (session: Session) => T))
}
