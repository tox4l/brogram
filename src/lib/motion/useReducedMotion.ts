'use client'

import { useSyncExternalStore } from 'react'
import type { MotionPreference } from '@/lib/contracts'

const QUERY = '(prefers-reduced-motion: reduce)'

function subscribe(callback: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const mql = window.matchMedia(QUERY)
  mql.addEventListener('change', callback)
  return () => mql.removeEventListener('change', callback)
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(QUERY).matches
}

function getServerSnapshot(): boolean {
  return false
}

/**
 * The only place `prefers-reduced-motion` is read (R7.9). Returns the
 * RESOLVED boolean, not the raw OS signal — standing constraint 12 says
 * "every animating component reads `useReducedMotion()`", so that name must
 * already account for the in-app override or a component written exactly to
 * the letter of that rule gets the wrong answer the one time it matters most
 * (`wellness.prefs.motion = 'full'` on an OS that asks for less). A bare
 * `useReducedMotion()` call means `'system'` — defer entirely to the OS.
 * Callers that hold the learner's actual preference (from wherever the
 * wellness prefs eventually live) pass it: `useReducedMotion(prefs.motion)`.
 */
export function useReducedMotion(pref?: MotionPreference): boolean {
  const osReduce = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return resolveMotion(pref ?? 'system', osReduce)
}

/**
 * The pure combiner `useReducedMotion` is built on, exported so a call site
 * that already has both values in hand (or a test) never needs the hook.
 * An explicit preference always wins over the OS: `resolveMotion('full', true)
 * === false` is the load-bearing case — the learner opted back into motion
 * even though their OS asks for less. `'system'` defers entirely to the OS signal.
 */
export function resolveMotion(pref: MotionPreference, osReduce: boolean): boolean {
  if (pref === 'full') return false
  if (pref === 'reduced') return true
  return osReduce
}
