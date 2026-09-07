import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetDiagnosticsForTests, useDiagnostics } from './diagnostics'

type Callback = (list: { getEntries: () => unknown[] }) => void

class FakePerformanceObserver {
  static supportedEntryTypes = ['largest-contentful-paint', 'layout-shift', 'event']
  static instances: FakePerformanceObserver[] = []
  callback: Callback
  type: string | undefined

  constructor(callback: Callback) {
    this.callback = callback
    FakePerformanceObserver.instances.push(this)
  }

  observe(options: { type: string }) {
    this.type = options.type
  }

  disconnect() {}

  emit(entries: unknown[]) {
    this.callback({ getEntries: () => entries })
  }
}

function observerFor(type: string): FakePerformanceObserver {
  const found = FakePerformanceObserver.instances.find((instance) => instance.type === type)
  if (!found) throw new Error(`no observer registered for ${type}`)
  return found
}

const originalPerformanceObserver = globalThis.PerformanceObserver
const originalGetEntriesByType = performance.getEntriesByType.bind(performance)

beforeEach(() => {
  resetDiagnosticsForTests()
  FakePerformanceObserver.instances = []
  // @ts-expect-error -- test stub, narrower than the real DOM type
  globalThis.PerformanceObserver = FakePerformanceObserver
  vi.spyOn(performance, 'getEntriesByType').mockReturnValue([])
})
afterEach(() => {
  globalThis.PerformanceObserver = originalPerformanceObserver
  performance.getEntriesByType = originalGetEntriesByType
  vi.restoreAllMocks()
})

describe('useDiagnostics', () => {
  it('starts empty', () => {
    const { result } = renderHook(() => useDiagnostics())
    expect(result.current).toEqual([])
  })

  it('records the largest LCP entry seen', () => {
    const { result } = renderHook(() => useDiagnostics())
    act(() => { observerFor('largest-contentful-paint').emit([{ startTime: 1234.6 }]) })
    expect(result.current).toEqual([{ id: expect.any(String), metric: 'LCP', value: 1235, at: expect.any(Number) }])
  })

  it('records a layout shift, skipping one caused by recent input', () => {
    const { result } = renderHook(() => useDiagnostics())
    act(() => {
      observerFor('layout-shift').emit([
        { value: 0.02, hadRecentInput: false },
        { value: 0.5, hadRecentInput: true },
      ])
    })
    expect(result.current).toEqual([{ id: expect.any(String), metric: 'CLS', value: 0.02, at: expect.any(Number) }])
  })

  it('records an INP-eligible event entry only, ignoring one with no interactionId', () => {
    const { result } = renderHook(() => useDiagnostics())
    act(() => {
      observerFor('event').emit([
        { duration: 40, interactionId: 0 },
        { duration: 180, interactionId: 7 },
      ])
    })
    expect(result.current).toEqual([{ id: expect.any(String), metric: 'INP', value: 180, at: expect.any(Number) }])
  })

  it('caps the ring buffer at 20 entries, dropping the oldest', () => {
    const { result } = renderHook(() => useDiagnostics())
    for (let i = 0; i < 25; i += 1) {
      act(() => { observerFor('layout-shift').emit([{ value: i / 100, hadRecentInput: false }]) })
    }
    expect(result.current).toHaveLength(20)
    expect(result.current[0].value).toBeCloseTo(0.05)
    expect(result.current.at(-1)?.value).toBeCloseTo(0.24)
  })

  it('never throws when PerformanceObserver is unavailable', () => {
    // @ts-expect-error -- simulating an environment without the API
    globalThis.PerformanceObserver = undefined
    expect(() => renderHook(() => useDiagnostics())).not.toThrow()
  })
})
