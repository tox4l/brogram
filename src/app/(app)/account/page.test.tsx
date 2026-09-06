import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  updateUser: vi.fn(),
}))

vi.mock('@/store/session', () => ({
  useSession: () => ({ user: { id: 'u1', email: 'learner@uni.edu.qa' } }),
}))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { updateUser: mocks.updateUser } }),
}))

import AccountPage from './page'

async function fillAndSubmit(password: string, confirmPassword: string) {
  render(<AccountPage />)
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: password } })
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: confirmPassword } })
  fireEvent.click(screen.getByRole('button', { name: /change password/i }))
}

describe('Account page', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.updateUser.mockResolvedValue({ data: {}, error: null })
  })
  afterEach(() => cleanup())

  it('shows the signed-in email', () => {
    render(<AccountPage />)
    expect(screen.getByText('learner@uni.edu.qa')).toBeTruthy()
  })

  it('shows a mismatch message and never calls updateUser when the passwords differ', async () => {
    await fillAndSubmit('longenough1', 'longenough2')
    expect(screen.getByRole('alert').textContent).toMatch(/do not match/i)
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })

  it('shows a length message and never calls updateUser when the password is too short', async () => {
    await fillAndSubmit('short1', 'short1')
    expect(screen.getByRole('alert').textContent).toMatch(/at least 8 characters/i)
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })

  it('calls updateUser once and shows the confirmation on success', async () => {
    await fillAndSubmit('longenough1', 'longenough1')
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/password has been changed/i))
    expect(mocks.updateUser).toHaveBeenCalledTimes(1)
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: 'longenough1' })
  })

  it('shows the Supabase error on failure and does not show the success message', async () => {
    mocks.updateUser.mockResolvedValue({ data: null, error: { message: 'Session expired' } })
    await fillAndSubmit('longenough1', 'longenough1')
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Session expired'))
    expect(screen.queryByRole('status')).toBeNull()
  })
})
