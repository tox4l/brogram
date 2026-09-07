import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Home from './page'

describe('landing page', () => {
  it('shows the wordmark and one filled sign-in action, with no hard-coded palette class', () => {
    const { container } = render(<Home />)
    expect(screen.getByText('Learn by writing code, graded where you write it.')).toBeTruthy()
    const link = screen.getByRole('link', { name: 'Sign in' })
    expect(link.getAttribute('href')).toBe('/login')
    expect(container.innerHTML).not.toMatch(/emerald/)
  })
})
