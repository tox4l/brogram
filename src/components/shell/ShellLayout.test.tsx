import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ShellLayout } from './ShellLayout'

const mocks = vi.hoisted(() => ({ pathname: vi.fn() }))
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname() }))

afterEach(cleanup)

describe('ShellLayout', () => {
  it('renders the skip-link target and the dock slot', () => {
    mocks.pathname.mockReturnValue('/dashboard')
    render(
      <ShellLayout dock={<div>Wellness dock</div>}>
        <h1>Dashboard content</h1>
      </ShellLayout>,
    )

    const main = screen.getByRole('main')
    expect(main.id).toBe('main-content')
    expect(main.tabIndex).toBe(-1)
    expect(screen.getByText('Dashboard content')).toBeTruthy()

    const aside = screen.getByRole('complementary', { name: 'Wellness' })
    expect(aside).toBeTruthy()
    expect(screen.getByText('Wellness dock')).toBeTruthy()
  })

  it('keeps the right-rail, 15rem grid outside the exercise route', () => {
    mocks.pathname.mockReturnValue('/dashboard')
    render(<ShellLayout dock={<div>Dock</div>}><p>Content</p></ShellLayout>)

    const grid = screen.getByRole('main').parentElement
    expect(grid?.className).toContain('lg:grid-cols-[minmax(0,1fr)_15rem]')
    const aside = screen.getByRole('complementary', { name: 'Wellness' })
    expect(aside.className).not.toContain('order-first')
  })

  it('keeps the existing exercise-route case: dock leads, compact strip', () => {
    mocks.pathname.mockReturnValue('/exercise/one')
    render(<ShellLayout dock={<div>Compact dock</div>}><p>Exercise content</p></ShellLayout>)

    const grid = screen.getByRole('main').parentElement
    expect(grid?.className).not.toContain('lg:grid-cols-[minmax(0,1fr)_15rem]')
    const aside = screen.getByRole('complementary', { name: 'Wellness' })
    expect(aside.className).toContain('order-first')
  })
})
