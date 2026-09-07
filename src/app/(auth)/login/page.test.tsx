import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signInWithOtp: vi.fn(),
  maybeSingle: vi.fn(),
  replace: vi.fn(),
  params: new URLSearchParams(),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { signInWithPassword: mocks.signInWithPassword, signInWithOtp: mocks.signInWithOtp },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) }),
  }),
}))
vi.mock('next/navigation', () => ({
  useSearchParams: () => mocks.params,
  useRouter: () => ({ replace: mocks.replace }),
}))

async function submitPassword(email = 'learner@uni.edu.qa', password = 'correct-horse') {
  const { default: Login } = await import('./page')
  render(<Login />)
  fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: email } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('email and password login', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.params = new URLSearchParams()
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null })
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
  })

  it('signs in and routes to onboarding when learner_state is missing', async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null })
    await submitPassword()
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({ email: 'learner@uni.edu.qa', password: 'correct-horse' })
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/onboarding'))
  })

  it('signs in and routes to onboarding when onboardingComplete is false', async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    mocks.maybeSingle.mockResolvedValue({ data: { state: { profile: { onboardingComplete: false } } }, error: null })
    await submitPassword()
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/onboarding'))
  })

  it('signs in and routes to dashboard when onboardingComplete is true', async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    mocks.maybeSingle.mockResolvedValue({ data: { state: { profile: { onboardingComplete: true } } }, error: null })
    await submitPassword()
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/dashboard'))
  })

  it('routes to dashboard, never onboarding, when the learner_state read fails', async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { message: 'unavailable' } })
    await submitPassword()
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/dashboard'))
    expect(mocks.replace).not.toHaveBeenCalledWith('/onboarding')
  })

  it('falls back to the dashboard, without a sign-in error, when the post-auth lookup throws', async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    mocks.maybeSingle.mockRejectedValue(new Error('network down'))
    await submitPassword()
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/dashboard'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows the Supabase error verbatim on failure and does not navigate', async () => {
    const message = 'Invalid login credentials'
    mocks.signInWithPassword.mockResolvedValue({ data: { user: null }, error: { message } })
    await submitPassword()
    expect((await screen.findByRole('alert')).textContent).toBe(message)
    expect(mocks.replace).not.toHaveBeenCalled()
  })

  it('renders a retryable error when the request throws', async () => {
    mocks.signInWithPassword.mockRejectedValue(new Error('connection refused'))
    await submitPassword()
    expect((await screen.findByRole('alert')).textContent).toContain('Try again')
    expect((screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows the existing ?error= messages verbatim', async () => {
    mocks.params = new URLSearchParams('error=invalid-link')
    const { default: Login } = await import('./page')
    render(<Login />)
    expect(screen.getByRole('alert').textContent).toContain('expired or is invalid')
  })

  it('shows the signed-out banned notice and does not attempt sign-in', async () => {
    mocks.params = new URLSearchParams('reason=banned')
    const { default: Login } = await import('./page')
    render(<Login />)
    expect(screen.getByRole('alert').textContent).toContain('This BroGram account has been banned.')
    expect(screen.getByText(/Contact Velocity/)).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(mocks.signInWithPassword).not.toHaveBeenCalled()
  })

  it('hides the magic-link form by default and never calls signInWithOtp', async () => {
    const { default: Login } = await import('./page')
    render(<Login />)
    expect(screen.queryByRole('button', { name: /magic link/i })).toBeNull()
    expect(mocks.signInWithOtp).not.toHaveBeenCalled()
  })

  it('shows the magic-link form when NEXT_PUBLIC_AUTH_MAGIC_LINK is true', async () => {
    vi.stubEnv('NEXT_PUBLIC_AUTH_MAGIC_LINK', 'true')
    vi.resetModules()
    const { default: Login } = await import('./page')
    render(<Login />)
    expect(screen.getByRole('button', { name: 'Send magic link' })).toBeTruthy()

    mocks.signInWithOtp.mockResolvedValue({ data: { user: null, session: null }, error: null })
    fireEvent.change(screen.getByLabelText('Email', { selector: '#magic-link-email' }), { target: { value: 'learner@uni.edu.qa' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send magic link' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Check your email'))
    expect(mocks.signInWithOtp).toHaveBeenCalledWith({
      email: 'learner@uni.edu.qa',
      options: { emailRedirectTo: `${window.location.origin}/auth/confirm`, shouldCreateUser: true },
    })
  })
})
