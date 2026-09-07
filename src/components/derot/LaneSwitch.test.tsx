import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LaneSwitch } from './LaneSwitch'

afterEach(cleanup)

describe('LaneSwitch', () => {
  it('renders both lanes as tabs, marking the active one selected', () => {
    render(<LaneSwitch lane="arcade" onChange={vi.fn()} />)
    expect(screen.getByRole('tab', { name: 'Arcade' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Playground' }).getAttribute('aria-selected')).toBe('false')
  })

  it('switches lanes on click', () => {
    const onChange = vi.fn()
    render(<LaneSwitch lane="arcade" onChange={onChange} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Playground' }))
    expect(onChange).toHaveBeenCalledWith('play')
  })

  it('is keyboard-operable: ArrowRight from the active tab moves to and selects the other lane', () => {
    const onChange = vi.fn()
    render(<LaneSwitch lane="arcade" onChange={onChange} />)
    const active = screen.getByRole('tab', { name: 'Arcade' })
    active.focus()
    expect(document.activeElement).toBe(active)
    fireEvent.keyDown(active, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenCalledWith('play')
  })

  it('ArrowLeft wraps around from the first tab to the last', () => {
    const onChange = vi.fn()
    render(<LaneSwitch lane="arcade" onChange={onChange} />)
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Arcade' }), { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenCalledWith('play')
  })

  it('only the active tab is in the normal tab order (roving tabindex)', () => {
    render(<LaneSwitch lane="play" onChange={vi.fn()} />)
    expect(screen.getByRole('tab', { name: 'Playground' }).getAttribute('tabindex')).toBe('0')
    expect(screen.getByRole('tab', { name: 'Arcade' }).getAttribute('tabindex')).toBe('-1')
  })
})
