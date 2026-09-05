import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { UsersTable } from './UsersTable'
import type { UserRow } from './types'

afterEach(cleanup)

function makeUser(overrides: Partial<UserRow>): UserRow {
  return {
    id: 'u1',
    display_name: 'Ali',
    email: 'ali@x.edu.qa',
    account_status: 'active',
    restricted_until: null,
    integrity_score: 5,
    event_counts: {},
    last_seen_at: '2026-09-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('UsersTable', () => {
  it('shows a designed empty state when there are no users', () => {
    render(<UsersTable rows={[]} onLift={vi.fn()} onRestrict={vi.fn()} onBan={vi.fn()} />)
    expect(screen.getByText(/no users/i)).toBeTruthy()
  })

  it('disables Lift for an active user (only warned/restricted/banned may be lifted)', () => {
    render(<UsersTable rows={[makeUser({ account_status: 'active' })]} onLift={vi.fn()} onRestrict={vi.fn()} onBan={vi.fn()} />)
    expect((screen.getByRole('button', { name: 'Lift' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('enables Lift for a warned user', () => {
    render(<UsersTable rows={[makeUser({ account_status: 'warned' })]} onLift={vi.fn()} onRestrict={vi.fn()} onBan={vi.fn()} />)
    expect((screen.getByRole('button', { name: 'Lift' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('disables Restrict once a user is already restricted', () => {
    render(<UsersTable rows={[makeUser({ account_status: 'restricted' })]} onLift={vi.fn()} onRestrict={vi.fn()} onBan={vi.fn()} />)
    expect((screen.getByRole('button', { name: 'Restrict' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('disables Restrict and Lift-adjacent actions once a user is banned, but Ban itself is disabled', () => {
    render(<UsersTable rows={[makeUser({ account_status: 'banned' })]} onLift={vi.fn()} onRestrict={vi.fn()} onBan={vi.fn()} />)
    expect((screen.getByRole('button', { name: 'Restrict' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Ban' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Lift' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows the integrity score alongside the threshold band it sits under', () => {
    render(<UsersTable rows={[makeUser({ integrity_score: 25 })]} onLift={vi.fn()} onRestrict={vi.fn()} onBan={vi.fn()} />)
    expect(screen.getByText('25')).toBeTruthy()
    // 25 sits at/above the restrict threshold (20) but below ban (40).
    expect(screen.getByText(/20/)).toBeTruthy()
  })

  it('sorts by integrity score descending by default', () => {
    render(
      <UsersTable
        rows={[
          makeUser({ id: 'low', display_name: 'Low', integrity_score: 3 }),
          makeUser({ id: 'high', display_name: 'High', integrity_score: 30 }),
          makeUser({ id: 'mid', display_name: 'Mid', integrity_score: 12 }),
        ]}
        onLift={vi.fn()}
        onRestrict={vi.fn()}
        onBan={vi.fn()}
      />
    )
    const names = screen.getAllByText(/^(Low|High|Mid)$/).map((el) => el.textContent)
    expect(names).toEqual(['High', 'Mid', 'Low'])
  })

  it('formats last-seen in UTC so server and Doha (UTC+3) renders agree', () => {
    // 23:30 UTC on Jan 1 must still read as Jan 1, never Jan 2, regardless of the
    // runtime's local timezone.
    render(
      <UsersTable
        rows={[makeUser({ last_seen_at: '2026-01-01T23:30:00Z' })]}
        onLift={vi.fn()}
        onRestrict={vi.fn()}
        onBan={vi.fn()}
      />
    )
    expect(screen.getByText('Jan 1')).toBeTruthy()
  })

  it('asks for confirmation before calling onBan', async () => {
    const onBan = vi.fn()
    render(<UsersTable rows={[makeUser({ id: 'u9', account_status: 'active' })]} onLift={vi.fn()} onRestrict={vi.fn()} onBan={onBan} />)

    fireEvent.click(screen.getByRole('button', { name: 'Ban' }))
    expect(onBan).not.toHaveBeenCalled()

    const confirmButton = await screen.findByRole('button', { name: /confirm ban/i })
    fireEvent.click(confirmButton)

    expect(onBan).toHaveBeenCalledTimes(1)
    expect(onBan).toHaveBeenCalledWith('u9')
  })
})
