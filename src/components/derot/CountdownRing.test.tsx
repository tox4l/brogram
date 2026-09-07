import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ play: vi.fn(), withInterfaceSounds: vi.fn((run: () => void) => run()) }))
vi.mock('@/lib/sound/manager', () => ({ play: mocks.play, withInterfaceSounds: mocks.withInterfaceSounds }))

import { CountdownRing } from './CountdownRing'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('CountdownRing', () => {
  it('shows the numeric seconds remaining, rounded up', () => {
    render(<CountdownRing remainingMs={4200} percentRemaining={80} />)
    expect(screen.getByRole('timer').textContent).toContain('5s')
  })

  it('renders a plain numeric countdown under reduced motion instead of the ring', () => {
    render(<CountdownRing remainingMs={3000} percentRemaining={50} reduced />)
    const timer = screen.getByRole('timer')
    expect(timer.querySelector('svg')).toBeNull()
    expect(timer.textContent).toBe('3s')
  })

  it('renders the ring (svg) when motion is not reduced', () => {
    render(<CountdownRing remainingMs={3000} percentRemaining={50} />)
    expect(screen.getByRole('timer').querySelector('svg')).not.toBeNull()
  })

  it('is silent above 25 percent remaining even with ticking enabled', () => {
    render(<CountdownRing remainingMs={8000} percentRemaining={80} tickEnabled />)
    expect(mocks.play).not.toHaveBeenCalled()
  })

  it('ticks once entering the amber band with ticking enabled', () => {
    render(<CountdownRing remainingMs={2000} percentRemaining={20} tickEnabled />)
    expect(mocks.withInterfaceSounds).toHaveBeenCalledTimes(1)
    expect(mocks.play).toHaveBeenCalledWith('ui.tap')
  })

  it('never ticks when ticking is not enabled, even in the red band', () => {
    render(<CountdownRing remainingMs={500} percentRemaining={5} />)
    expect(mocks.play).not.toHaveBeenCalled()
  })
})
