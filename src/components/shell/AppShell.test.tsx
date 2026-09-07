import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from './AppShell'

// What is under test here is the header row's own markup -- every sibling
// already has its own test file, and `ShellLayout` (T2.4's grid/placement
// logic) has its own dedicated `ShellLayout.test.tsx`.
vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }))
vi.mock('./ShellHeaderControls', () => ({ ShellHeaderControls: () => null }))
vi.mock('./ShellLayout', () => ({ ShellLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('./WellnessSlot', () => ({ WellnessSlot: () => null }))
vi.mock('@/lib/perf/marks', () => ({ markPerf: () => {}, SHELL_READY: 'shell-ready' }))

afterEach(() => cleanup())

describe('AppShell', () => {
  // T4.5 (wave 4 plan, "Tests it adds"): a bounding-box proxy for "Header
  // content height 56px -- a rule, not a band" (spec section 4). jsdom has
  // no real layout engine, so this pins the `h-14` (56px) class the real box
  // model resolves from `sm:` up, where the nav sits on one line;
  // e2e/measure.spec.ts (T4.10) asserts the actual rendered geometry at
  // 1280x800 -- comfortably inside the `sm:` breakpoint.
  it('locks the header row to 56px (h-14) from the sm breakpoint up', () => {
    render(<AppShell>content</AppShell>)
    const wordmark = screen.getByRole('link', { name: /brogram/i })
    const headerRow = wordmark.parentElement
    expect(headerRow?.className).toMatch(/\bsm:h-14\b/)
  })

  it('gives nav items an 8px+ gap (gap-2)', () => {
    render(<AppShell>content</AppShell>)
    const nav = screen.getByRole('navigation', { name: /main navigation/i })
    expect(nav.className).toMatch(/\bgap-2\b/)
  })
})
