import type { PropsWithChildren } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { User } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountStatus } from '@/lib/contracts'
import { INTEGRITY_THRESHOLDS } from '@/lib/contracts'
import { makeQueryClient } from '@/lib/query/client'
import { line } from '@/lib/voice/lines'
import { SessionProvider } from '@/components/shell/SessionProvider'
import { recordLocalIntegrityEvent, clearLocalIntegrityLog } from '@/lib/integrity/localLog'
import { IntegrityPanel } from './IntegrityPanel'

const spies = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc: spies.rpc }) }))

function setup(status: AccountStatus, props?: Parameters<typeof IntegrityPanel>[0]) {
  const initial = {
    user: { id: 'student' } as User,
    profile: { id: 'student', account_status: status, restricted_until: null },
    learnerState: null,
  }
  const queryClient = makeQueryClient()
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>
      <SessionProvider initialState={initial}>{children}</SessionProvider>
    </QueryClientProvider>
  )
  return render(<IntegrityPanel {...props} />, { wrapper })
}

const RPC_ROWS = [
  { event_type: 'printscreen', events: 3, weight: 3, points: 9 },
  { event_type: 'paste-blocked', events: 4, weight: 2, points: 8 },
  { event_type: 'blur', events: 3, weight: 1, points: 3 },
]

beforeEach(() => {
  vi.clearAllMocks()
  clearLocalIntegrityLog()
  spies.rpc.mockResolvedValue({ data: RPC_ROWS, error: null })
})
afterEach(() => { cleanup() })

describe('IntegrityPanel', () => {
  it('renders nothing for a banned account', async () => {
    const { container } = setup('banned')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(container.firstChild).toBeNull()
    expect(spies.rpc).not.toHaveBeenCalled()
  })

  it('renders the policy explainer and the exact thresholds from the contracts, for the full variant', async () => {
    setup('active')
    await waitFor(() => expect(screen.getByText('Total 20.')).toBeTruthy())
    expect(screen.getByText('Integrity, explained')).toBeTruthy()
    expect(screen.getByText(line('guard.why'))).toBeTruthy()
    expect(screen.getByText(String(INTEGRITY_THRESHOLDS.warnAt))).toBeTruthy()
    expect(screen.getByText(String(INTEGRITY_THRESHOLDS.restrictAt))).toBeTruthy()
    expect(screen.getByText(String(INTEGRITY_THRESHOLDS.banAt))).toBeTruthy()
    expect(screen.getByText(String(INTEGRITY_THRESHOLDS.instantRestrictPasteCount))).toBeTruthy()
  })

  it("itemises every row with the trigger's own weights and points, matching the spec 9.4 example verbatim", async () => {
    setup('active')
    await waitFor(() => expect(screen.getByText('Total 20.')).toBeTruthy())
    expect(screen.getByText('Screenshot attempts')).toBeTruthy()
    expect(screen.getByText('3 at weight 3 — 9')).toBeTruthy()
    expect(screen.getByText('Paste blocked')).toBeTruthy()
    expect(screen.getByText('4 at weight 2 — 8')).toBeTruthy()
    expect(screen.getByText('Tab-away')).toBeTruthy()
    expect(screen.getByText('3 at weight 1 — 3')).toBeTruthy()
  })

  it('omits the policy explainer for the receipt variant, keeping only the itemised rows', async () => {
    setup('warned', { variant: 'receipt' })
    await waitFor(() => expect(screen.getByText(/^Total 20\./)).toBeTruthy())
    expect(screen.queryByText('Integrity, explained')).toBeNull()
    expect(screen.queryByText(line('guard.why'))).toBeNull()
  })

  it('names the line the account crossed, defaulting from accountStatus (warned -> 10, restricted -> 20)', async () => {
    const { unmount } = setup('warned')
    await waitFor(() => expect(screen.getByText('Total 20. The line is 10.')).toBeTruthy())
    unmount()
    cleanup()
    setup('restricted')
    await waitFor(() => expect(screen.getByText('Total 20. The line is 20.')).toBeTruthy())
  })

  it('names no line at all on the plain (active) Account view unless one is passed explicitly', async () => {
    setup('active')
    await waitFor(() => expect(screen.getByText('Total 20.')).toBeTruthy())
    expect(screen.queryByText(/The line is/)).toBeNull()
  })

  it('an explicit crossedAt overrides the status default', async () => {
    setup('warned', { crossedAt: 40 })
    await waitFor(() => expect(screen.getByText('Total 20. The line is 40.')).toBeTruthy())
  })

  it('falls back to this browser\'s own local log when the RPC is missing (schema 0005), and says so', async () => {
    spies.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.my_integrity_breakdown' } })
    recordLocalIntegrityEvent('paste-blocked')
    recordLocalIntegrityEvent('paste-blocked')
    recordLocalIntegrityEvent('blur')
    setup('active')
    await waitFor(() => expect(screen.getByText('Total 5.')).toBeTruthy())
    expect(screen.getByText('Paste blocked')).toBeTruthy()
    expect(screen.getByText('2 at weight 2 — 4')).toBeTruthy()
    expect(screen.getByText(/what this browser itself has recorded/)).toBeTruthy()
  })

  it('does not show the local-source caveat when the server answered', async () => {
    setup('active')
    await waitFor(() => expect(screen.getByText('Total 20.')).toBeTruthy())
    expect(screen.queryByText(/what this browser itself has recorded/)).toBeNull()
  })

  it('shows "no flags" rather than an empty table when the learner has none', async () => {
    spies.rpc.mockResolvedValue({ data: [], error: null })
    setup('active')
    await waitFor(() => expect(screen.getByText('No flags in the last 7 days.')).toBeTruthy())
  })
})
