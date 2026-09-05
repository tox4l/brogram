import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { StatusBadge } from './StatusBadge'

afterEach(cleanup)

describe('StatusBadge', () => {
  it('renders a distinct label and look for every account status', () => {
    const statuses = ['active', 'warned', 'restricted', 'banned'] as const
    const seen = new Set<string>()

    for (const status of statuses) {
      const { unmount } = render(<StatusBadge status={status} />)
      const el = screen.getByText(new RegExp(status, 'i'))
      expect(el).toBeTruthy()
      const className = el.className
      expect(seen.has(className)).toBe(false)
      seen.add(className)
      unmount()
    }
  })

  it('flags banned with the destructive token, the only real color in the palette', () => {
    render(<StatusBadge status="banned" />)
    const el = screen.getByText(/banned/i)
    expect(el.className).toMatch(/destructive/)
  })
})
