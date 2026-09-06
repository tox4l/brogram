import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CreateAccountForm } from './CreateAccountForm'

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: async () => body } as Response)
}

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('CreateAccountForm', () => {
  it('rejects submission without a valid email', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    render(<CreateAccountForm />)

    fireEvent.change(screen.getByLabelText('Account email'), { target: { value: 'not-an-email' } })
    fireEvent.change(screen.getByLabelText('Temporary password'), { target: { value: 'longenough1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(screen.getByText(/valid email/i)).toBeTruthy()
  })

  it('rejects a password shorter than 8 characters', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    render(<CreateAccountForm />)

    fireEvent.change(screen.getByLabelText('Account email'), { target: { value: 'learner@uni.edu.qa' } })
    fireEvent.change(screen.getByLabelText('Temporary password'), { target: { value: 'short1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(screen.getByText(/at least 8 characters/i)).toBeTruthy()
  })

  it('fills a 12-character password from the generate button, excluding visually ambiguous characters', () => {
    render(<CreateAccountForm />)
    for (let i = 0; i < 25; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
      const input = screen.getByLabelText('Temporary password') as HTMLInputElement
      expect(input.value).toHaveLength(12)
      expect(input.value).toMatch(/^[A-Za-z0-9]+$/)
      expect(input.value).not.toMatch(/[0O1lIio]/)
    }
  })

  it('disables autocomplete and spellcheck on the temporary-password input', () => {
    render(<CreateAccountForm />)
    const input = screen.getByLabelText('Temporary password') as HTMLInputElement
    expect(input.getAttribute('autocomplete')).toBe('off')
    expect(input.getAttribute('spellcheck')).toBe('false')
  })

  it('posts the trimmed, lowercased email and shows the created email with the temporary password once', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ ok: true, id: 'new-uid', email: 'learner@uni.edu.qa' })))
    render(<CreateAccountForm />)

    fireEvent.change(screen.getByLabelText('Account email'), { target: { value: '  Learner@UNI.edu.qa  ' } })
    fireEvent.change(screen.getByLabelText('Temporary password'), { target: { value: 'longenough1' } })
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Learner' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('learner@uni.edu.qa'))
    expect(screen.getByRole('status').textContent).toContain('longenough1')

    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toBe('/api/admin/users/create')
    const body = JSON.parse(call[1].body as string)
    expect(body).toEqual({ email: 'learner@uni.edu.qa', password: 'longenough1', displayName: 'Learner' })

    expect((screen.getByLabelText('Account email') as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('status').textContent).toContain('change this password on their Account page')
  })

  it('dismisses the shown-once panel when Dismiss is clicked', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ ok: true, id: 'new-uid', email: 'learner@uni.edu.qa' })))
    render(<CreateAccountForm />)

    fireEvent.change(screen.getByLabelText('Account email'), { target: { value: 'learner@uni.edu.qa' } })
    fireEvent.change(screen.getByLabelText('Temporary password'), { target: { value: 'longenough1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows the error message when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ ok: false, error: 'an account for this email already exists' }, false)))
    render(<CreateAccountForm />)

    fireEvent.change(screen.getByLabelText('Account email'), { target: { value: 'dupe@uni.edu.qa' } })
    fireEvent.change(screen.getByLabelText('Temporary password'), { target: { value: 'longenough1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(screen.getByText('an account for this email already exists')).toBeTruthy())
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('calls onCreated after a successful submission', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ ok: true, id: 'new-uid', email: 'learner@uni.edu.qa' })))
    const onCreated = vi.fn()
    render(<CreateAccountForm onCreated={onCreated} />)

    fireEvent.change(screen.getByLabelText('Account email'), { target: { value: 'learner@uni.edu.qa' } })
    fireEvent.change(screen.getByLabelText('Temporary password'), { target: { value: 'longenough1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))
  })
})
