'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { createSessionStore, SessionContext, type SessionData } from '@/store/session'

export function SessionProvider({ initialState, children }: { initialState: SessionData; children: ReactNode }) {
  const [store] = useState(() => createSessionStore(initialState))
  useEffect(() => {
    const incoming = initialState.learnerState
    const current = store.getState().learnerState
    if (incoming && (!current || incoming.version > current.version)) store.setState({ learnerState: incoming })
  }, [initialState.learnerState, store])
  return <SessionContext.Provider value={store}>{children}</SessionContext.Provider>
}
