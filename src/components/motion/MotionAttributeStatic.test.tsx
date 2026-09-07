import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

// W4FIX-B2: the root-layout half of MotionAttribute's split (see the
// component's own header comment). No QueryClientProvider, no Supabase
// mock -- proving it needs neither is the point: `/` and `/login` mount
// this, not the full `MotionAttribute`, precisely so neither route pays for
// TanStack Query or the Supabase client just to resolve `data-motion`.

class FakeMediaQueryList {
  matches: boolean
  private listeners = new Set<(event: { matches: boolean }) => void>()

  constructor(matches: boolean) {
    this.matches = matches
  }

  addEventListener(_type: 'change', listener: (event: { matches: boolean }) => void) {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'change', listener: (event: { matches: boolean }) => void) {
    this.listeners.delete(listener)
  }
}

function installMatchMedia(initial: boolean) {
  const mql = new FakeMediaQueryList(initial)
  window.matchMedia = ((query: string) => {
    if (query !== '(prefers-reduced-motion: reduce)') throw new Error(`unexpected query: ${query}`)
    return mql as unknown as MediaQueryList
  }) as typeof window.matchMedia
}

afterEach(() => {
  cleanup()
  delete document.documentElement.dataset.motion
})

describe('MotionAttributeStatic', () => {
  it('writes data-motion="reduced" when the OS asks to reduce motion, with no query client in the tree', async () => {
    installMatchMedia(true)
    const { MotionAttributeStatic } = await import('./MotionAttributeStatic')
    render(<MotionAttributeStatic />)
    await waitFor(() => expect(document.documentElement.dataset.motion).toBe('reduced'))
  })

  it('writes data-motion="full" when the OS reports no preference', async () => {
    installMatchMedia(false)
    const { MotionAttributeStatic } = await import('./MotionAttributeStatic')
    render(<MotionAttributeStatic />)
    await waitFor(() => expect(document.documentElement.dataset.motion).toBe('full'))
  })

  it('renders nothing', async () => {
    installMatchMedia(false)
    const { MotionAttributeStatic } = await import('./MotionAttributeStatic')
    const { container } = render(<MotionAttributeStatic />)
    expect(container.innerHTML).toBe('')
  })
})
