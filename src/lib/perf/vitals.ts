'use client'

/**
 * The in-memory web-vitals ring buffer Account → Diagnostics reads from (spec R5.5, plan
 * T3.2 step 4). No `/api/vitals`, no `fetch`, no `navigator.sendBeacon` — ever (standing
 * constraint 9: no telemetry route handler, anywhere). Anyone — including a fork on their
 * own hosting — reads their own numbers with no server involved.
 *
 * `useVitalsCollector()` wires Next's own `useReportWebVitals` (`next/web-vitals`) into this
 * buffer, using the docs' own recommended shape: a dedicated, otherwise-empty client
 * component (`VitalsCollector.tsx`) a layout renders once, near the root. That mount landed
 * in `src/app/providers.tsx` (fix round 2), so `useVitals()` is fed on every route, not just
 * `(app)`. `src/app/(app)/account/diagnostics.ts` (T2.3) also renders the Account →
 * Diagnostics section from its own self-contained `PerformanceObserver` collector, built
 * before this module existed — it merges both sources (fix round 2) rather than dropping
 * either.
 */

import { useCallback, useSyncExternalStore } from 'react'
import { useReportWebVitals } from 'next/web-vitals'

export type VitalName = 'LCP' | 'INP' | 'CLS'
export type VitalRating = 'good' | 'needs-improvement' | 'poor'

export interface VitalEntry {
  id: string
  name: VitalName
  /** Milliseconds for LCP/INP; a unitless shift score for CLS — same convention as the
   *  `web-vitals` library's own `metric.value`. */
  value: number
  rating: VitalRating
  at: number
}

/** The only shape this module needs from `useReportWebVitals`'s callback argument, kept
 *  narrow on purpose so a unit test never has to construct a full Next `Metric`. */
export interface ReportedMetric {
  name: string
  value: number
  rating?: string
}

const TRACKED_NAMES: ReadonlySet<string> = new Set<VitalName>(['LCP', 'INP', 'CLS'])
const MAX_ENTRIES = 20

let entries: VitalEntry[] = []
let seq = 0
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

function isVitalName(name: string): name is VitalName {
  return TRACKED_NAMES.has(name)
}

function isVitalRating(rating: string | undefined): rating is VitalRating {
  return rating === 'good' || rating === 'needs-improvement' || rating === 'poor'
}

/**
 * Keeps only the three metrics this product ever shows (LCP, INP, CLS) — `useReportWebVitals`
 * also reports FCP, FID and TTFB (plus Next's own custom hydration metrics), which this
 * buffer silently drops rather than growing a panel nobody asked for.
 */
export function recordVital(metric: ReportedMetric): void {
  if (!isVitalName(metric.name)) return
  seq += 1
  const rating: VitalRating = isVitalRating(metric.rating) ? metric.rating : 'poor'
  entries = [...entries, { id: `vital-${seq}`, name: metric.name, value: metric.value, rating, at: Date.now() }].slice(-MAX_ENTRIES)
  notify()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): readonly VitalEntry[] {
  return entries
}

function getServerSnapshot(): readonly VitalEntry[] {
  return entries
}

/** Reads the ring buffer reactively. Purely local: nothing here is shared across viewers,
 *  persisted past a reload, or ever sent anywhere. */
export function useVitals(): readonly VitalEntry[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/**
 * Mount once, near the root, in a client component with no other job (the `useReportWebVitals`
 * docs' own recommended shape). `useCallback` with an empty dependency array keeps the
 * callback reference stable, per that hook's own contract ("ensure the callback function
 * reference does not change") — a changing reference would re-register the observer and can
 * duplicate reports.
 */
export function useVitalsCollector(): void {
  const onReport = useCallback((metric: ReportedMetric) => recordVital(metric), [])
  useReportWebVitals(onReport)
}

/** Test-only: forgets every recorded entry. */
export function resetVitalsForTests(): void {
  entries = []
  seq = 0
}
