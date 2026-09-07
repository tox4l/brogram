import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { line } from '@/lib/voice/lines'
import { AccountNotice, BannedAccount } from './AccountNotice'

vi.mock('@/components/account/IntegrityPanel', () => ({
  IntegrityPanel: (props: { variant?: string }) => <div data-testid="integrity-panel" data-variant={props.variant ?? 'full'} />,
}))

afterEach(() => { cleanup() })

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
    const { container } = render(<AccountNotice status="active" restrictedUntil={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing for a banned account (banned has its own unauthenticated screen)', () => {
    const { container } = render(<AccountNotice status="banned" restrictedUntil={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders guard.warned plus the itemised receipt, not the old surveillance-register v1 line', () => {
    render(<AccountNotice status="warned" restrictedUntil={null} />)
    expect(screen.getByText(line('guard.warned'))).toBeTruthy()
    expect(screen.queryByText(/Type your own work/)).toBeNull()
    const panel = screen.getByTestId('integrity-panel')
    expect(panel.dataset.variant).toBe('receipt')
  })

  it('renders guard.restricted plus the itemised receipt, naming a restriction end time when known', () => {
    render(<AccountNotice status="restricted" restrictedUntil="2026-09-08T12:00:00.000Z" />)
    expect(screen.getByTestId('integrity-panel').dataset.variant).toBe('receipt')
    expect(screen.getByText(/Reps are paused for 24 hours/)).toBeTruthy()
    expect(screen.getByText(/2026|Sept|Doha/)).toBeTruthy()
  })

  it('still names a next step for restricted with no known restriction end time', () => {
    render(<AccountNotice status="restricted" restrictedUntil={null} />)
    expect(screen.getByText(/the next review/)).toBeTruthy()
  })

  it('links to the full policy in Account for both warned and restricted', () => {
    render(<AccountNotice status="warned" restrictedUntil={null} />)
    expect(screen.getByRole('link', { name: 'Integrity, explained' })).toHaveProperty('href', expect.stringContaining('/account'))

    render(<AccountNotice status="restricted" restrictedUntil={null} />)
    expect(screen.getAllByRole('link', { name: 'Integrity, explained' }).length).toBeGreaterThan(0)
  })
})
