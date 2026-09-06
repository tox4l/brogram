import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ThemeProvider } from 'next-themes'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeQuickSwitch } from './ThemeQuickSwitch'

const STORAGE_KEY = 'brogram:theme'

// next-themes registers a `matchMedia` listener unconditionally on mount
// (even with `enableSystem={false}`), and `useReducedMotion` reads it too.
// jsdom has no `matchMedia` at all, so every test needs a stand-in; tests
// that care about reduced motion swap in a query-aware version.
function installMatchMedia(reducedMotion = false) {
  window.matchMedia = ((query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)' ? reducedMotion : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

function renderSwitch() {
  return render(
    <ThemeProvider
      attribute="data-theme"
      themes={['midnight', 'amber', 'paper', 'arcade']}
      defaultTheme="midnight"
      enableSystem={false}
      storageKey={STORAGE_KEY}
      disableTransitionOnChange
    >
      <ThemeQuickSwitch />
    </ThemeProvider>,
  )
}

beforeEach(() => {
  installMatchMedia()
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ThemeQuickSwitch', () => {
  it('opens on the trigger and exposes a radiogroup of all four themes', () => {
    renderSwitch()
    fireEvent.click(screen.getByRole('button', { name: /choose theme/i }))
    const group = screen.getByRole('radiogroup', { name: /theme/i })
    expect(within(group).getAllByRole('radio')).toHaveLength(4)
    expect(screen.getByRole('radio', { name: 'Midnight' }).getAttribute('aria-checked')).toBe('true')
  })

  it('keyboard-only traversal cycles through all four and selects each one', () => {
    renderSwitch()
    fireEvent.click(screen.getByRole('button', { name: /choose theme/i }))

    let activeRadio = screen.getByRole('radio', { name: 'Midnight' })
    expect(activeRadio.getAttribute('aria-checked')).toBe('true')

    fireEvent.keyDown(activeRadio, { key: 'ArrowRight' })
    activeRadio = screen.getByRole('radio', { name: 'Amber' })
    expect(activeRadio.getAttribute('aria-checked')).toBe('true')
    expect(document.documentElement.getAttribute('data-theme')).toBe('amber')

    fireEvent.keyDown(activeRadio, { key: 'ArrowRight' })
    activeRadio = screen.getByRole('radio', { name: 'Paper' })
    expect(activeRadio.getAttribute('aria-checked')).toBe('true')
    expect(document.documentElement.getAttribute('data-theme')).toBe('paper')

    fireEvent.keyDown(activeRadio, { key: 'ArrowRight' })
    activeRadio = screen.getByRole('radio', { name: 'Arcade' })
    expect(activeRadio.getAttribute('aria-checked')).toBe('true')
    expect(document.documentElement.getAttribute('data-theme')).toBe('arcade')

    // Wraps back around to Midnight.
    fireEvent.keyDown(activeRadio, { key: 'ArrowRight' })
    activeRadio = screen.getByRole('radio', { name: 'Midnight' })
    expect(activeRadio.getAttribute('aria-checked')).toBe('true')
    expect(document.documentElement.getAttribute('data-theme')).toBe('midnight')
  })

  it('ArrowLeft moves to the previous theme', () => {
    renderSwitch()
    fireEvent.click(screen.getByRole('button', { name: /choose theme/i }))
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Midnight' }), { key: 'ArrowLeft' })
    expect(screen.getByRole('radio', { name: 'Arcade' }).getAttribute('aria-checked')).toBe('true')
    expect(document.documentElement.getAttribute('data-theme')).toBe('arcade')
  })

  it('choosing a theme writes data-theme on <html> and persists it to storage', () => {
    renderSwitch()
    fireEvent.click(screen.getByRole('button', { name: /choose theme/i }))
    fireEvent.click(screen.getByRole('radio', { name: 'Paper' }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('paper')
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('paper')
  })

  it('the choice survives a remount', () => {
    const first = renderSwitch()
    fireEvent.click(screen.getByRole('button', { name: /choose theme/i }))
    fireEvent.click(screen.getByRole('radio', { name: 'Amber' }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('amber')
    first.unmount()

    renderSwitch()
    expect(document.documentElement.getAttribute('data-theme')).toBe('amber')
    fireEvent.click(screen.getByRole('button', { name: /choose theme/i }))
    expect(screen.getByRole('radio', { name: 'Amber' }).getAttribute('aria-checked')).toBe('true')
  })

  it('does not call document.startViewTransition under reduced motion', () => {
    installMatchMedia(true)
    const startViewTransition = vi.fn((callback: () => void) => {
      callback()
      return {} as ViewTransition
    })
    document.startViewTransition = startViewTransition as unknown as typeof document.startViewTransition

    renderSwitch()
    fireEvent.click(screen.getByRole('button', { name: /choose theme/i }))
    fireEvent.click(screen.getByRole('radio', { name: 'Arcade' }))

    expect(startViewTransition).not.toHaveBeenCalled()
    expect(document.documentElement.getAttribute('data-theme')).toBe('arcade')
  })

  it('calls document.startViewTransition when motion is not reduced', () => {
    const startViewTransition = vi.fn((callback: () => void) => {
      callback()
      return {} as ViewTransition
    })
    document.startViewTransition = startViewTransition as unknown as typeof document.startViewTransition

    renderSwitch()
    fireEvent.click(screen.getByRole('button', { name: /choose theme/i }))
    fireEvent.click(screen.getByRole('radio', { name: 'Arcade' }))

    expect(startViewTransition).toHaveBeenCalledTimes(1)
    expect(document.documentElement.getAttribute('data-theme')).toBe('arcade')
  })

  it('I4: the attribute is already applied *inside* the startViewTransition callback (flushSync), not only after it returns', () => {
    // next-themes applies `data-theme` in a passive effect, which without
    // `flushSync` would not have run yet at the instant this mock's
    // callback() returns -- only later, once outer `act()` flushes it. This
    // records the attribute synchronously right there, before anything else
    // can flush, which is exactly the window a real browser uses to
    // snapshot the "new" frame for the transition. A bare
    // `document.startViewTransition(() => setTheme(id))` (no `flushSync`)
    // would observe the OLD theme here; this is the regression I4 fixes.
    let attributeWhenCallbackReturns: string | null | undefined
    const startViewTransition = vi.fn((callback: () => void) => {
      callback()
      attributeWhenCallbackReturns = document.documentElement.getAttribute('data-theme')
      return {} as ViewTransition
    })
    document.startViewTransition = startViewTransition as unknown as typeof document.startViewTransition

    renderSwitch()
    fireEvent.click(screen.getByRole('button', { name: /choose theme/i }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('midnight')
    fireEvent.click(screen.getByRole('radio', { name: 'Arcade' }))

    expect(attributeWhenCallbackReturns).toBe('arcade')
  })
})

interface ViewTransition {
  ready: Promise<void>
  finished: Promise<void>
  updateCallbackDone: Promise<void>
  skipTransition: () => void
}
