// W4FIX-D (motion-css rule): `ProgressIndicator` used to fill via base-ui's
// own inline `width: N%` transitioned with `transition-all` -- both banned
// by the design gate (an animated width, and `transition: all`). It now
// pins its own `style.width` to 100% and fills with `transform: scaleX()`
// instead. These tests pin the swap so a regression back to width-based
// fill, or a reintroduced `transition-all`, fails loudly.
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Progress } from './progress'

afterEach(() => {
  cleanup()
})

function indicatorEl(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[data-slot="progress-indicator"]')
  if (!el) throw new Error('progress-indicator not found')
  return el as HTMLElement
}

describe('Progress', () => {
  it('fills with transform: scaleX() at the given percentage, width pinned to 100%', () => {
    const { container } = render(<Progress value={40} />)
    const indicator = indicatorEl(container)
    expect(indicator.style.width).toBe('100%')
    expect(indicator.style.transform).toBe('scaleX(0.4)')
  })

  it('never carries transition-all or an animated width/height (design gate rule 6)', () => {
    const { container } = render(<Progress value={75} />)
    const indicator = indicatorEl(container)
    expect(indicator.className).not.toMatch(/transition-all/)
    expect(indicator.className).toMatch(/transition-transform/)
  })

  it('clamps out-of-range values into [0, 100]', () => {
    const over = render(<Progress value={150} />)
    expect(indicatorEl(over.container).style.transform).toBe('scaleX(1)')
    over.unmount()
    const under = render(<Progress value={-20} />)
    expect(indicatorEl(under.container).style.transform).toBe('scaleX(0)')
  })

  it('respects a non-default min/max range', () => {
    const { container } = render(<Progress value={15} min={10} max={20} />)
    // (15 - 10) / (20 - 10) = 0.5
    expect(indicatorEl(container).style.transform).toBe('scaleX(0.5)')
  })

  it('renders at 0% when value is null (indeterminate)', () => {
    const { container } = render(<Progress value={null} />)
    expect(indicatorEl(container).style.transform).toBe('scaleX(0)')
  })
})
