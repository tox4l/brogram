import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { IntegrityBreakdown } from '@/lib/integrity/breakdown'
import { line } from '@/lib/voice/lines'
import { AccountNotice, BannedAccount } from './AccountNotice'

const mocks = vi.hoisted(() => ({ useIntegrityBreakdown: vi.fn() }))
vi.mock('@/components/account/IntegrityPanel', () => ({
  IntegrityPanel: (props: { variant?: string }) => <div data-testid="integrity-panel" data-variant={props.variant ?? 'full'} />,
  useIntegrityBreakdown: mocks.useIntegrityBreakdown,
}))

function serverBreakdown(total: number, pasteEvents = 0): IntegrityBreakdown {
  const rows = pasteEvents > 0
    ? [{ type: 'paste-blocked' as const, events: pasteEvents, weight: 2, points: pasteEvents * 2 }]
    : []
  return { rows, total, source: 'server' }
}

function localBreakdown(): IntegrityBreakdown {
  return { rows: [], total: 0, source: 'local' }
}

// F4 (W4FIX-B2 re-check): `Banner` now renders `DynamicIntegrityReceipt`
// (`next/dynamic(() => import('@/components/account/IntegrityPanel')...)`,
// see `AccountNotice.tsx`'s own doc) instead of calling `IntegrityPanel`/
// `useIntegrityBreakdown` directly. `React.lazy`'s resolved-component cache
// is a MODULE-level singleton, not per-test: the first render of a
// warned/restricted `Banner` anywhere in this file suspends for one
// microtask tick while the (mocked) chunk resolves, and every render after
// that is synchronous again for the rest of the process. Pre-warming it once
// here, before any test's assertion depends on synchronous rendering, keeps
// every test below free to render and assert in the same tick exactly as it
// could before the dynamic split -- without this, only the FIRST test in the
// file to render a warned/restricted account would flakily see the
// not-yet-resolved (empty) state, an ordering accident rather than a real
// assertion about behaviour.
beforeAll(async () => {
  mocks.useIntegrityBreakdown.mockReturnValue({ data: undefined })
  render(<AccountNotice status="warned" restrictedUntil={null} />)
  await waitFor(() => expect(screen.getByTestId('integrity-panel')).toBeTruthy())
  cleanup()
  vi.clearAllMocks()
})

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('BannedAccount', () => {
  // T2.7b: the heading's opening word changed from "Your" to "This" (voice
  // rule 3, never open with "Your"); re-pointed together with
  // `src/app/(auth)/login/page.test.tsx`, the other test that pinned it.
  it('keeps the original heading and contact line intact', () => {
    render(<BannedAccount />)
    expect(screen.getByRole('alert').textContent).toContain('This BroGram account has been banned.')
    expect(screen.getByText(/Contact Velocity/)).toBeTruthy()
  })

  // Fix round 1, C2: the actual gap the review found -- the weights, the
  // thresholds and the 7-day window reached no screen at all.
  it('adds the bank\'s full guard.banned disclosure underneath', () => {
    render(<BannedAccount />)
    expect(screen.getByText(line('guard.banned'))).toBeTruthy()
  })

  it('names the appeal channel in both the short line and the full disclosure', () => {
    render(<BannedAccount />)
    expect(screen.getAllByText(/Velocity through your invitation email/).length).toBe(2)
  })

  it('mounts no IntegrityPanel — this screen is unauthenticated and has no receipt underneath it', () => {
    render(<BannedAccount />)
    expect(screen.queryByTestId('integrity-panel')).toBeNull()
  })
})

describe('AccountNotice', () => {
  it('renders nothing for an active account', () => {
    mocks.useIntegrityBreakdown.mockReturnValue({ data: undefined })
    const { container } = render(<AccountNotice status="active" restrictedUntil={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing for a banned account (banned has its own unauthenticated screen)', () => {
    mocks.useIntegrityBreakdown.mockReturnValue({ data: undefined })
    const { container } = render(<AccountNotice status="banned" restrictedUntil={null} />)
    expect(container.firstChild).toBeNull()
  })

  // W2G-3: a clean learner (active, and the unauthenticated banned screen) must never fire
  // `my_integrity_breakdown()` -- the query used to run one line above the status check that
  // decides this component renders nothing, so it fired on every authenticated route load for
  // every learner, including the two routes budgeted at zero Supabase round trips.
  it('never queries the integrity breakdown for an active or banned account (W2G-3)', () => {
    mocks.useIntegrityBreakdown.mockReturnValue({ data: undefined })
    render(<AccountNotice status="active" restrictedUntil={null} />)
    expect(mocks.useIntegrityBreakdown).not.toHaveBeenCalled()
    render(<AccountNotice status="banned" restrictedUntil={null} />)
    expect(mocks.useIntegrityBreakdown).not.toHaveBeenCalled()
  })

  it('queries the integrity breakdown once mounted for a warned or restricted account (W2G-3)', () => {
    mocks.useIntegrityBreakdown.mockReturnValue({ data: undefined })
    render(<AccountNotice status="warned" restrictedUntil={null} />)
    expect(mocks.useIntegrityBreakdown).toHaveBeenCalledTimes(1)
    render(<AccountNotice status="restricted" restrictedUntil={null} />)
    expect(mocks.useIntegrityBreakdown).toHaveBeenCalledTimes(2)
  })

  it('links to the full policy in Account for both warned and restricted', () => {
    mocks.useIntegrityBreakdown.mockReturnValue({ data: undefined })
    render(<AccountNotice status="warned" restrictedUntil={null} />)
    expect(screen.getByRole('link', { name: 'Integrity, explained' })).toHaveProperty('href', expect.stringContaining('/account'))

    render(<AccountNotice status="restricted" restrictedUntil={null} />)
    expect(screen.getAllByRole('link', { name: 'Integrity, explained' }).length).toBeGreaterThan(0)
  })

  it('mounts the itemised receipt for both warned and restricted', () => {
    mocks.useIntegrityBreakdown.mockReturnValue({ data: undefined })
    render(<AccountNotice status="warned" restrictedUntil={null} />)
    expect(screen.getByTestId('integrity-panel').dataset.variant).toBe('receipt')
  })

  describe('N1 — the frame never promises an exact count the receipt underneath cannot back', () => {
    it('warned: renders the exact guard.warned wording once the breakdown is confirmed server-sourced', () => {
      mocks.useIntegrityBreakdown.mockReturnValue({ data: serverBreakdown(10) })
      render(<AccountNotice status="warned" restrictedUntil={null} />)
      expect(screen.getByText(line('guard.warned'))).toBeTruthy()
      expect(screen.queryByText(line('guard.warned.local'))).toBeNull()
    })

    it('warned: renders the honest local-record wording on the schema-0005 fallback', () => {
      mocks.useIntegrityBreakdown.mockReturnValue({ data: localBreakdown() })
      render(<AccountNotice status="warned" restrictedUntil={null} />)
      expect(screen.getByText(line('guard.warned.local'))).toBeTruthy()
      expect(screen.queryByText(line('guard.warned'))).toBeNull()
    })

    it('warned: defaults to the local-record wording while the breakdown is still loading, never flashing the exact claim', () => {
      mocks.useIntegrityBreakdown.mockReturnValue({ data: undefined, isLoading: true })
      render(<AccountNotice status="warned" restrictedUntil={null} />)
      expect(screen.getByText(line('guard.warned.local'))).toBeTruthy()
    })

    it('restricted: renders the exact guard.restricted wording once server-sourced with a score-crossing total', () => {
      mocks.useIntegrityBreakdown.mockReturnValue({ data: serverBreakdown(25) })
      render(<AccountNotice status="restricted" restrictedUntil={null} />)
      expect(screen.getByText(/Flags crossed 20 in the last 7 days/)).toBeTruthy()
    })

    it('restricted: renders the honest local-record wording on the schema-0005 fallback, naming no number', () => {
      mocks.useIntegrityBreakdown.mockReturnValue({ data: localBreakdown() })
      render(<AccountNotice status="restricted" restrictedUntil={null} />)
      expect(screen.getByText(/this device's own record/)).toBeTruthy()
      expect(screen.queryByText(/Flags crossed 20/)).toBeNull()
      expect(screen.queryByText(/Paste was blocked 5 times/)).toBeNull()
    })

    it('restricted: defaults to the local-record wording while loading', () => {
      mocks.useIntegrityBreakdown.mockReturnValue({ data: undefined, isLoading: true })
      render(<AccountNotice status="restricted" restrictedUntil={null} />)
      expect(screen.getByText(/this device's own record/)).toBeTruthy()
    })
  })

  describe('N3 — the restricted cause is derived from the server aggregate, not always the score threshold', () => {
    it('names the five-paste instant rule when the server total is under the restrict line with five or more pastes', () => {
      mocks.useIntegrityBreakdown.mockReturnValue({ data: serverBreakdown(10, 5) })
      render(<AccountNotice status="restricted" restrictedUntil={null} />)
      expect(screen.getByText(/Paste was blocked 5 times in one rep/)).toBeTruthy()
      expect(screen.queryByText(/Flags crossed 20/)).toBeNull()
    })

    it('names the score threshold once the total itself crosses the restrict line, even with five pastes (the boundary)', () => {
      mocks.useIntegrityBreakdown.mockReturnValue({ data: serverBreakdown(20, 5) })
      render(<AccountNotice status="restricted" restrictedUntil={null} />)
      expect(screen.getByText(/Flags crossed 20 in the last 7 days/)).toBeTruthy()
      expect(screen.queryByText(/Paste was blocked 5 times/)).toBeNull()
    })
  })

  it('renders guard.restricted plus the itemised receipt, naming a restriction end time when known', () => {
    mocks.useIntegrityBreakdown.mockReturnValue({ data: serverBreakdown(25) })
    render(<AccountNotice status="restricted" restrictedUntil="2026-09-08T12:00:00.000Z" />)
    expect(screen.getByTestId('integrity-panel').dataset.variant).toBe('receipt')
    expect(screen.getByText(/Reps are paused for 24 hours/)).toBeTruthy()
    expect(screen.getByText(/2026|Sept|Doha/)).toBeTruthy()
  })

  it('still names a next step for restricted with no known restriction end time', () => {
    mocks.useIntegrityBreakdown.mockReturnValue({ data: serverBreakdown(25) })
    render(<AccountNotice status="restricted" restrictedUntil={null} />)
    expect(screen.getByText(/the next review/)).toBeTruthy()
  })
})
