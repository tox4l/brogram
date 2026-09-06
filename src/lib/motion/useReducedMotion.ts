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
 * The only place `prefers-reduced-motion` is read (R7.9). Returns the live
 * OS signal only — combine it with `wellness.prefs.motion` via `resolveMotion`
 * at the call site, since an in-app override must be able to beat the OS
 * (`resolveMotion('full', true) === false`), which `matchMedia` structurally
 * cannot express on its own.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/**
 * Combine the in-app override with the OS signal. An explicit preference
 * always wins over the OS: `resolveMotion('full', true) === false` is the
 * load-bearing case — the learner opted back into motion even though their
 * OS asks for less. `'system'` defers entirely to the OS signal.
 */
export function resolveMotion(pref: MotionPreference, osReduce: boolean): boolean {
  if (pref === 'full') return false
  if (pref === 'reduced') return true
  return osReduce
}
