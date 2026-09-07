import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ComboMeter } from './ComboMeter'

afterEach(cleanup)

describe('ComboMeter', () => {
  it('shows "No combo" at streak zero', () => {
    render(<ComboMeter streak={0} multiplier={1} />)
    expect(screen.getByText('No combo')).toBeTruthy()
  })

  it('shows the streak count and multiplier', () => {
    render(<ComboMeter streak={3} multiplier={1.5} />)
    expect(screen.getByText('3x combo')).toBeTruthy()
    expect(screen.getByText('1.5×')).toBeTruthy()
  })

  it('exposes the combo as an accessible status, not colour alone', () => {
    render(<ComboMeter streak={4} multiplier={2} />)
    const status = screen.getByRole('status')
    expect(status.getAttribute('aria-label')).toContain('Combo 4')
    expect(status.getAttribute('aria-label')).toContain('2 times multiplier')
  })

  it('never throws under reduced motion, and settles immediately', () => {
    render(<ComboMeter streak={2} multiplier={1.2} reduced />)
    expect(screen.getByText('2x combo')).toBeTruthy()
  })
})
