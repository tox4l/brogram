import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { InvitesTable } from './InvitesTable'
import type { InviteRow } from './types'

afterEach(cleanup)

const rows: InviteRow[] = [
  { code: 'OLD-OPEN', email: 'a@x.edu.qa', created_at: '2026-01-01T00:00:00Z', redeemed_at: null, redeemed_by: null },
  { code: 'NEW-REDEEMED', email: 'b@x.edu.qa', created_at: '2026-03-01T00:00:00Z', redeemed_at: '2026-03-02T00:00:00Z', redeemed_by: 'u1' },
  { code: 'NEW-OPEN', email: 'c@x.edu.qa', created_at: '2026-02-01T00:00:00Z', redeemed_at: null, redeemed_by: null },
]

describe('InvitesTable', () => {
  it('shows a designed empty state when there are no invites', () => {
    render(<InvitesTable rows={[]} />)
    expect(screen.getByText('No invites yet. Mint one above.')).toBeTruthy()
  })

  it('sorts open invites first, then by newest within each group', () => {
    render(<InvitesTable rows={rows} />)
    const codeCells = screen.getAllByText(/^(OLD-OPEN|NEW-REDEEMED|NEW-OPEN)$/)
    expect(codeCells.map((el) => el.textContent)).toEqual(['NEW-OPEN', 'OLD-OPEN', 'NEW-REDEEMED'])
  })

  it('shows open invites as open and redeemed invites with their redemption date', () => {
    render(<InvitesTable rows={rows} />)
    expect(screen.getAllByText('Open')).toHaveLength(2)
    expect(screen.getByText(/Redeemed/)).toBeTruthy()
  })

  it('formats the created date in UTC so server and Doha (UTC+3) renders agree', () => {
    // 23:30 UTC on Jan 1 must still read as Jan 1, never Jan 2, regardless of the
    // runtime's local timezone (this is what would flip to Jan 2 in Doha if the
    // formatter used the local zone instead of pinning UTC).
    const lateUtcRow: InviteRow[] = [
      { code: 'LATE-UTC', email: 'z@x.edu.qa', created_at: '2026-01-01T23:30:00Z', redeemed_at: null, redeemed_by: null },
    ]
    render(<InvitesTable rows={lateUtcRow} />)
    expect(screen.getByText('Jan 1, 2026')).toBeTruthy()
  })

  it('calls onRevoke with the code of an open invite only', () => {
    const onRevoke = vi.fn()
    render(<InvitesTable rows={rows} onRevoke={onRevoke} />)
    const revokeButtons = screen.getAllByRole('button', { name: /revoke/i })
    // Only the two open invites get a revoke action.
    expect(revokeButtons).toHaveLength(2)
    fireEvent.click(revokeButtons[0])
    expect(onRevoke).toHaveBeenCalledTimes(1)
    expect(['OLD-OPEN', 'NEW-OPEN']).toContain(onRevoke.mock.calls[0][0])
  })
})
