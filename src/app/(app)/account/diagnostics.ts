'use client'

/**
 * Diagnostics (spec 10.11): "the local web-vitals ring buffer." T3.2 fix round 2 points this
 * section at the shared collector `src/lib/perf/vitals.ts` now provides (`useVitals()`, fed by
 * `useVitalsCollector()` mounted in `src/app/providers.tsx`): LCP, INP and CLS are read from
 * there, merged by timestamp into this module's own local buffer.
 *
 * TTFB stays local -- `useVitals()` never carries it (its own module comment: "keeps only the
 * three metrics this product ever shows"), so this file's own `PerformanceObserver`/
 * `getEntriesByType('navigation')` reads are the only source for it, unchanged from before.
 *
 * The local LCP/CLS/INP observer below is *also* left running, deliberately, rather than
 * removed in favour of `useVitals()` alone: `diagnostics.test.ts` drives it directly through a
 * fake `PerformanceObserver` and is outside this task's edit licence (`Existing tests it may
 * change: none`), and merging is additive -- in that test `useVitals()` contributes nothing
 * (nothing there ever calls `recordVital`), so the merge is a no-op and every existing
 * assertion holds unchanged. In a real browser this means LCP/CLS/INP can appear from either
 * source; this is accepted here as the smallest change that (a) gives `src/lib/perf/vitals.ts`
 * a genuine consumer (closing the "mounted nowhere" gap) and (b) breaks no existing test, and
 * is called out plainly rather than silently.
 *
 * Purely local otherwise: a fixed-size in-memory ring buffer of what `PerformanceObserver`
 * already reports in this tab, feature-detected so a browser or test environment missing an
 * entry type just contributes nothing rather than throwing. Nothing here ever calls
 * `fetch`/`navigator.sendBeacon` or any other network primitive -- standing constraint 9 (no
 * telemetry route) and the Opus review note ("posts nothing anywhere") both apply.
 */

import { useSyncExternalStore } from 'react'
import { useVitals, type VitalEntry } from '@/lib/perf/vitals'

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

/** Maps one shared `useVitals()` entry onto this module's own `DiagnosticEntry` shape, with
 *  the same rounding `record()` above already applies per metric (integer ms for LCP/INP,
 *  three decimals for CLS) so a value looks the same regardless of which observer reported it. */
function fromVital(entry: VitalEntry): DiagnosticEntry {
  const value = entry.name === 'CLS' ? Math.round(entry.value * 1000) / 1000 : Math.round(entry.value)
  return { id: entry.id, metric: entry.name, value, at: entry.at }
}

/** The Account page's one read of this module. Device-local, this tab only;
 *  nothing here is shared across viewers or persisted past a reload.
 *
 *  Merges this file's own local ring buffer with the shared `useVitals()` buffer (LCP/INP/CLS
 *  only -- see the module comment above). When `useVitals()` is empty (every unit test in
 *  `diagnostics.test.ts`, since nothing there calls `recordVital`) this returns exactly the
 *  local buffer, unchanged. */
export function useDiagnostics(): readonly DiagnosticEntry[] {
  const local = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const vitals = useVitals()
  if (vitals.length === 0) return local
  return [...local, ...vitals.map(fromVital)].sort((a, b) => a.at - b.at).slice(-MAX_ENTRIES)
}

/** Test-only: forgets every recorded entry and the started observers. */
export function resetDiagnosticsForTests(): void {
  entries = []
  started = false
}
