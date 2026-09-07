import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BuddyButton } from './BuddyButton'

// The drawer itself has its own test file (`src/components/buddy/Drawer.test.tsx`)
// -- what is under test here is the header trigger alone.
vi.mock('@/components/buddy/Drawer', () => ({ BuddyDrawer: () => null }))

afterEach(() => cleanup())

describe('BuddyButton', () => {
  it('renders the trigger with an accessible name', () => {
    render(<BuddyButton />)
    expect(screen.getByRole('button', { name: /buddy/i })).toBeTruthy()
  })

  // T4.5 (wave 4 plan, "Tests it adds"): a bounding-box proxy for the 44px
  // header control -- jsdom has no real layout engine, so this pins the
  // `h-11` (44px) class the real box model resolves; e2e/measure.spec.ts
  // (T4.10) asserts the actual rendered geometry at 1280x800.
  it('carries the 44px header-control height class', () => {
    render(<BuddyButton />)
    expect(screen.getByRole('button', { name: /buddy/i }).className).toMatch(/\bh-11\b/)
  })
})
