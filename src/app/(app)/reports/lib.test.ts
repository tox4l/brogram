import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useFreshlyUnlocked } from './lib'

describe('useFreshlyUnlocked', () => {
  it('reports nothing fresh while the query has not settled yet, even with real ids already in hand', () => {
    const { result } = renderHook(({ ids, ready }) => useFreshlyUnlocked(ids, ready), {
      initialProps: { ids: ['first-blood'], ready: false },
    })
    expect(result.current).toEqual([])
  })

  it('treats everything already unlocked at settle time as the baseline, not fresh', () => {
    const { result, rerender } = renderHook(({ ids, ready }) => useFreshlyUnlocked(ids, ready), {
      initialProps: { ids: [] as string[], ready: false },
    })
    // The query resolves with two already-held trophies.
    rerender({ ids: ['first-blood', 'day-three'], ready: true })
    expect(result.current).toEqual([])

    // A later re-render with the exact same ids stays empty.
    rerender({ ids: ['first-blood', 'day-three'], ready: true })
    expect(result.current).toEqual([])
  })

  it('flags an id unlocked after the baseline was captured as fresh', () => {
    const { result, rerender } = renderHook(({ ids, ready }) => useFreshlyUnlocked(ids, ready), {
      initialProps: { ids: ['first-blood'], ready: true },
    })
    expect(result.current).toEqual([])

    rerender({ ids: ['first-blood', 'three-angles'], ready: true })
    expect(result.current).toEqual(['three-angles'])
  })

  it('never mutates the baseline once captured, even across unrelated re-renders', () => {
    const { result, rerender } = renderHook(({ ids, ready }) => useFreshlyUnlocked(ids, ready), {
      initialProps: { ids: ['first-blood'], ready: true },
    })
    rerender({ ids: ['first-blood', 'three-angles'], ready: true })
    expect(result.current).toEqual(['three-angles'])
    // A repeat render with the same list keeps reporting the same fresh id --
    // it never "settles" back to baseline while this instance stays mounted.
    rerender({ ids: ['first-blood', 'three-angles'], ready: true })
    expect(result.current).toEqual(['three-angles'])
  })
})
