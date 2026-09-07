import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { recordVital, resetVitalsForTests, useVitals } from './vitals'

afterEach(() => {
  resetVitalsForTests()
})

describe('useVitals', () => {
  it('starts empty', () => {
    const { result } = renderHook(() => useVitals())
    expect(result.current).toEqual([])
  })

  it('records LCP, INP and CLS', () => {
    const { result } = renderHook(() => useVitals())
    act(() => {
      recordVital({ name: 'LCP', value: 1234, rating: 'good' })
      recordVital({ name: 'INP', value: 180, rating: 'needs-improvement' })
      recordVital({ name: 'CLS', value: 0.02, rating: 'good' })
    })
    expect(result.current).toEqual([
      { id: expect.any(String), name: 'LCP', value: 1234, rating: 'good', at: expect.any(Number) },
      { id: expect.any(String), name: 'INP', value: 180, rating: 'needs-improvement', at: expect.any(Number) },
      { id: expect.any(String), name: 'CLS', value: 0.02, rating: 'good', at: expect.any(Number) },
    ])
  })

  it('drops every metric that is not LCP, INP or CLS', () => {
    const { result } = renderHook(() => useVitals())
    act(() => {
      recordVital({ name: 'FCP', value: 800, rating: 'good' })
      recordVital({ name: 'FID', value: 10, rating: 'good' })
      recordVital({ name: 'TTFB', value: 200, rating: 'good' })
      recordVital({ name: 'Next.js-hydration', value: 50 })
    })
    expect(result.current).toEqual([])
  })

  it('falls back to "poor" for a missing or unrecognized rating', () => {
    const { result } = renderHook(() => useVitals())
    act(() => { recordVital({ name: 'LCP', value: 3000 }) })
    expect(result.current).toEqual([{ id: expect.any(String), name: 'LCP', value: 3000, rating: 'poor', at: expect.any(Number) }])
  })

  it('caps the ring buffer at 20 entries, dropping the oldest', () => {
    const { result } = renderHook(() => useVitals())
    for (let i = 0; i < 25; i += 1) {
      act(() => { recordVital({ name: 'CLS', value: i / 100, rating: 'good' }) })
    }
    expect(result.current).toHaveLength(20)
    expect(result.current[0].value).toBeCloseTo(0.05)
    expect(result.current.at(-1)?.value).toBeCloseTo(0.24)
  })

  it('notifies every mounted subscriber', () => {
    const first = renderHook(() => useVitals())
    const second = renderHook(() => useVitals())
    act(() => { recordVital({ name: 'INP', value: 90, rating: 'good' }) })
    expect(first.result.current).toHaveLength(1)
    expect(second.result.current).toHaveLength(1)
  })

  it('resetVitalsForTests forgets every recorded entry', () => {
    const { result, rerender } = renderHook(() => useVitals())
    act(() => { recordVital({ name: 'LCP', value: 1000, rating: 'good' }) })
    expect(result.current).toHaveLength(1)
    resetVitalsForTests()
    rerender()
    expect(result.current).toEqual([])
  })
})
