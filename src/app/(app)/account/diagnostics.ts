'use client'

/**
 * Diagnostics (spec 10.11): "the local web-vitals ring buffer." T3.2
 * (`src/lib/perf/**`) is the task that eventually owns a shared collector --
 * it has not landed yet (Wave 3 runs after this one) and this task does not
 * own that path, so this is a small, self-contained, dependency-free
 * collector scoped entirely to the Account page. It never imports from, or
 * writes into, `src/lib/perf/**`; a later task can point this section at a
 * shared module without this file's shape being load-bearing anywhere else.
 *
 * Purely local: a fixed-size in-memory ring buffer of what
 * `PerformanceObserver` already reports in this tab, feature-detected so a
 * browser or test environment missing an entry type just contributes nothing
 * rather than throwing. Nothing here ever calls `fetch`/`navigator.sendBeacon`
 * or any other network primitive -- standing constraint 9 (no telemetry
 * route) and the Opus review note ("posts nothing anywhere") both apply.
 */

import { useSyncExternalStore } from 'react'

export type DiagnosticMetric = 'LCP' | 'CLS' | 'INP' | 'TTFB'

export interface DiagnosticEntry {
  id: string
  metric: DiagnosticMetric
  /** Milliseconds for LCP/INP/TTFB; a unitless shift score for CLS. */
  value: number
  at: number
}

const MAX_ENTRIES = 20

let entries: DiagnosticEntry[] = []
let seq = 0
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

function record(metric: DiagnosticMetric, value: number): void {
  seq += 1
  entries = [...entries, { id: `diag-${seq}`, metric, value, at: Date.now() }].slice(-MAX_ENTRIES)
  notify()
}

let started = false

/** Wires up every observer this browser supports; a no-op, repeatable call
 *  when a given entry type is unsupported (feature-detected per call, not
 *  once for the whole function) or when called more than once. */
function start(): void {
  if (started || typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return
  started = true

  const supported = new Set(PerformanceObserver.supportedEntryTypes ?? [])

  function observe(type: string, onEntries: (list: PerformanceObserverEntryList) => void): void {
    if (!supported.has(type)) return
    try {
      const observer = new PerformanceObserver(onEntries)
      observer.observe({ type, buffered: true })
    } catch {
      // Best-effort: a diagnostics panel must never be the thing that breaks the page.
    }
  }

  observe('largest-contentful-paint', (list) => {
    const last = list.getEntries().at(-1)
    if (last) record('LCP', Math.round(last.startTime))
  })

  observe('layout-shift', (list) => {
    for (const item of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
      if (!item.hadRecentInput) record('CLS', Math.round(item.value * 1000) / 1000)
    }
  })

  observe('event', (list) => {
    for (const item of list.getEntries() as (PerformanceEntry & { duration: number; interactionId?: number })[]) {
      if (item.interactionId) record('INP', Math.round(item.duration))
    }
  })

  try {
    const [nav] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[]
    if (nav) record('TTFB', Math.round(nav.responseStart))
  } catch {
    // Feature-detected above; a throwing `getEntriesByType` is not worth surfacing here.
  }
}

function subscribe(listener: () => void): () => void {
  start()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): readonly DiagnosticEntry[] {
  return entries
}

function getServerSnapshot(): readonly DiagnosticEntry[] {
  return entries
}

/** The Account page's one read of this module. Device-local, this tab only;
 *  nothing here is shared across viewers or persisted past a reload. */
export function useDiagnostics(): readonly DiagnosticEntry[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/** Test-only: forgets every recorded entry and the started observers. */
export function resetDiagnosticsForTests(): void {
  entries = []
  started = false
}
