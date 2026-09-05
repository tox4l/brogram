import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ signInWithOtp: vi.fn(), params: new URLSearchParams() }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { signInWithOtp: mocks.signInWithOtp } }) }))
vi.mock('next/navigation', () => ({ useSearchParams: () => mocks.params }))

describe('email login', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.params = new URLSearchParams() })
  afterEach(cleanup)

  async function submit() {
    const { default: Login } = await import('./page')
    render(<Login />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: 'uninvited@gmail.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send magic link' }))
  }

  it('shows the hook rejection verbatim and lets the hook decide domain and invite eligibility', async () => {
    const message = 'Invite refused: ask Velocity for access. Exact hook detail.'
    mocks.signInWithOtp.mockResolvedValue({ data: { user: null, session: null }, error: { message } })
    await submit()
    expect((await screen.findByRole('alert')).textContent).toBe(message)
    expect(mocks.signInWithOtp).toHaveBeenCalledWith({ email: 'uninvited@gmail.com', options: {
      emailRedirectTo: `${window.location.origin}/auth/confirm`, shouldCreateUser: true,
    } })
  })

  it('acknowledges a sent link without duplicate submissions while sending', async () => {
    let finish!: (result: unknown) => void
    mocks.signInWithOtp.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    await submit()
    expect((screen.getByRole('button', { name: 'Sending link…' }) as HTMLButtonElement).disabled).toBe(true)
    finish({ data: { user: null, session: null }, error: null })
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Check your email'))
  })

  it('renders a retryable error when the request fails', async () => {
    mocks.signInWithOtp.mockRejectedValue(new Error('connection refused'))
    await submit()
    expect((await screen.findByRole('alert')).textContent).toContain('Try again')
    expect((screen.getByRole('button', { name: 'Send magic link' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows the signed-out banned notice and Velocity contact line', async () => {
    mocks.params = new URLSearchParams('reason=banned')
    const { default: Login } = await import('./page')
    render(<Login />)
    expect(screen.getByRole('alert').textContent).toContain('Your BroGram account has been banned.')
    expect(screen.getByText(/Contact Velocity/)).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(mocks.signInWithOtp).not.toHaveBeenCalled()
  })
})
