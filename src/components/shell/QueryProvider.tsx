'use client'

import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { getQueryClient } from '@/lib/query/client'

/**
 * Wraps `SessionProvider`: Zustand holds the synchronous session snapshot the
 * whole shell reads, TanStack Query owns fetching, dedupe and mutations.
 * `getQueryClient` is the documented singleton — a fresh client per server
 * render, one reused client in the browser — so no user's cache can ever leak
 * into another's SSR pass.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={getQueryClient()}>{children}</QueryClientProvider>
}
