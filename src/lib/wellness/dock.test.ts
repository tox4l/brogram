import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { DockCorner, WellnessDockPrefs } from '@/lib/contracts'
import { DEFAULT_WELLNESS } from '@/lib/contracts'
import {
  effectiveCollapsed, gridTemplateFor, isFocusRoute, nextCorner, orientationFor,
  recallDockPlacement, rememberDockPlacement, resetDockPrefsCacheForTests, useCachedDockPrefs, writeCachedDockPrefs,
} from './dock'

describe('orientationFor', () => {
  it('maps left and right to vertical', () => {
    expect(orientationFor('left')).toBe('vertical')
    expect(orientationFor('right')).toBe('vertical')
  })
  it('maps top to horizontal', () => {
    expect(orientationFor('top')).toBe('horizontal')
  })
  it('maps float to pill', () => {
    expect(orientationFor('float')).toBe('pill')
  })
  it('maps hidden to none', () => {
    expect(orientationFor('hidden')).toBe('none')
  })
})

describe('gridTemplateFor', () => {
  it('maps left/right to their rail templates', () => {
    expect(gridTemplateFor('left')).toBe('left-rail')
    expect(gridTemplateFor('right')).toBe('right-rail')
  })
  it('maps top to a top strip', () => {
    expect(gridTemplateFor('top')).toBe('top-strip')
  })
  it('maps float and hidden to a portal (outside the grid)', () => {
    expect(gridTemplateFor('float')).toBe('portal')
    expect(gridTemplateFor('hidden')).toBe('portal')
  })
})

describe('isFocusRoute', () => {
  it('matches the exercise route and its children', () => {
    expect(isFocusRoute('/exercise')).toBe(true)
    expect(isFocusRoute('/exercise/abc-123')).toBe(true)
  })
  it('matches the lesson route and its children', () => {
    expect(isFocusRoute('/lesson')).toBe(true)
    expect(isFocusRoute('/lesson/INFS1101-3')).toBe(true)
  })
  it('does not match other routes, including a prefix collision', () => {
    expect(isFocusRoute('/dashboard')).toBe(false)
    expect(isFocusRoute('/exercised')).toBe(false)
  })
})

const dock = (patch: Partial<WellnessDockPrefs> = {}): WellnessDockPrefs => ({ ...DEFAULT_WELLNESS.dock, ...patch })

describe('effectiveCollapsed', () => {
  it('is collapsed whenever the stored preference says so, anywhere', () => {
    expect(effectiveCollapsed(dock({ collapsed: true }), '/dashboard')).toBe(true)
    expect(effectiveCollapsed(dock({ collapsed: true }), '/exercise/one')).toBe(true)
  })

  it('collapses on the exercise and lesson routes when compactOnExercise is on (the default)', () => {
    expect(effectiveCollapsed(dock(), '/exercise/one')).toBe(true)
    expect(effectiveCollapsed(dock(), '/lesson/INFS1101-3')).toBe(true)
  })

  it('does not collapse elsewhere when the stored preference is expanded', () => {
    expect(effectiveCollapsed(dock(), '/dashboard')).toBe(false)
    expect(effectiveCollapsed(dock(), '/courses')).toBe(false)
  })

  it('stays expanded on the focus routes once compactOnExercise is turned off', () => {
    expect(effectiveCollapsed(dock({ compactOnExercise: false }), '/exercise/one')).toBe(false)
    expect(effectiveCollapsed(dock({ compactOnExercise: false }), '/lesson/INFS1101-3')).toBe(false)
  })
})

describe('nextCorner', () => {
  const cases: [DockCorner, string, DockCorner][] = [
    ['br', 'ArrowLeft', 'bl'],
    ['br', 'ArrowUp', 'tr'],
    ['bl', 'ArrowRight', 'br'],
    ['bl', 'ArrowUp', 'tl'],
    ['tl', 'ArrowDown', 'bl'],
    ['tl', 'ArrowRight', 'tr'],
    ['tr', 'ArrowDown', 'br'],
    ['tr', 'ArrowLeft', 'tl'],
  ]
  it.each(cases)('moves from %s to %s on %s', (from, key, to) => {
    expect(nextCorner(from, key)).toBe(to)
  })

  it('is a no-op past the grid edge (two lefts from the left column stays put)', () => {
    expect(nextCorner('bl', 'ArrowLeft')).toBe('bl')
    expect(nextCorner('tl', 'ArrowLeft')).toBe('tl')
  })

  it('ignores any key that is not an arrow key', () => {
    expect(nextCorner('br', 'Enter')).toBe('br')
    expect(nextCorner('br', ' ')).toBe('br')
  })

  it('cycles through all four corners via left/up/right/down', () => {
    let corner: DockCorner = 'br'
    corner = nextCorner(corner, 'ArrowLeft') // bl
    corner = nextCorner(corner, 'ArrowUp') // tl
    corner = nextCorner(corner, 'ArrowRight') // tr
    corner = nextCorner(corner, 'ArrowDown') // br
    expect(corner).toBe('br')
  })
})

describe('rememberDockPlacement / recallDockPlacement', () => {
  afterEach(() => sessionStorage.clear())

  it('defaults to right when nothing has ever been remembered', () => {
    expect(recallDockPlacement()).toBe('right')
  })

  it('recalls the last non-hidden placement that was remembered', () => {
    rememberDockPlacement('left')
    expect(recallDockPlacement()).toBe('left')
    rememberDockPlacement('float')
    expect(recallDockPlacement()).toBe('float')
  })

  it('never remembers hidden itself -- that would defeat the point', () => {
    rememberDockPlacement('top')
    rememberDockPlacement('hidden')
    expect(recallDockPlacement()).toBe('top')
  })
})

describe('useCachedDockPrefs / writeCachedDockPrefs (I2, step 4\'s local tier)', () => {
  afterEach(() => resetDockPrefsCacheForTests())

  it('is null before anything has ever been cached', () => {
    const { result } = renderHook(() => useCachedDockPrefs())
    expect(result.current).toBeNull()
  })

  it('reflects a write immediately, in the same render pass callers observe it', () => {
    const { result } = renderHook(() => useCachedDockPrefs())
    const dock: WellnessDockPrefs = { placement: 'left', collapsed: true, compactOnExercise: false, corner: 'tl' }
    act(() => writeCachedDockPrefs(dock))
    expect(result.current).toEqual(dock)
  })

  it('a fresh subscriber (e.g. after a remount) sees a value written earlier', () => {
    writeCachedDockPrefs({ placement: 'top', collapsed: false, compactOnExercise: true, corner: 'br' })
    const { result } = renderHook(() => useCachedDockPrefs())
    expect(result.current).toEqual({ placement: 'top', collapsed: false, compactOnExercise: true, corner: 'br' })
  })

  it('ignores a malformed cache entry rather than crashing', () => {
    localStorage.setItem('brogram:wellness:dock-cache', '{"placement":"sideways"}')
    const { result } = renderHook(() => useCachedDockPrefs())
    expect(result.current).toBeNull()
  })
})
