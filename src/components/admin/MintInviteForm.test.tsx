import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MintInviteForm } from './MintInviteForm'

afterEach(cleanup)

describe('MintInviteForm', () => {
  it('rejects an email that is not on the .edu.qa domain and shows an inline message', () => {
    const onMint = vi.fn()
    render(<MintInviteForm onMint={onMint} />)

    fireEvent.change(screen.getByLabelText(/invite email/i), { target: { value: 'user@gmail.com' } })
    fireEvent.click(screen.getByRole('button', { name: /mint/i }))

    expect(onMint).not.toHaveBeenCalled()
    expect(screen.getByText(/\.edu\.qa/)).toBeTruthy()
  })

  it('rejects a bare domain string with no local part before the @', () => {
    const onMint = vi.fn()
    render(<MintInviteForm onMint={onMint} />)

    fireEvent.change(screen.getByLabelText(/invite email/i), { target: { value: '.edu.qa' } })
    fireEvent.click(screen.getByRole('button', { name: /mint/i }))

    expect(onMint).not.toHaveBeenCalled()
    expect(screen.getByText(/\.edu\.qa/)).toBeTruthy()
  })

  it('accepts a .edu.qa email, trimmed and lowercased', () => {
    const onMint = vi.fn()
    render(<MintInviteForm onMint={onMint} />)

    fireEvent.change(screen.getByLabelText(/invite email/i), { target: { value: '  Student@X.EDU.QA  ' } })
    fireEvent.click(screen.getByRole('button', { name: /mint/i }))

    expect(onMint).toHaveBeenCalledTimes(1)
    expect(onMint).toHaveBeenCalledWith('student@x.edu.qa')
  })

  it('disables the input and the submit button while busy', () => {
    render(<MintInviteForm onMint={() => {}} busy />)

    expect((screen.getByLabelText(/invite email/i) as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /mint/i }) as HTMLButtonElement).disabled).toBe(true)
  })
})
