'use client'

/**
 * A shared, ephemeral "a reminder happened" signal (C3), separate from the
 * TanStack Query cache: `DockControl` (the header's hidden re-open glyph)
 * and the dock's own collapsed handle both need to show the same badge, and
 * they are cousins in the tree (one lives in `ShellHeaderControls`, the
 * other under `ShellLayout`'s dock slot) -- not ancestor/descendant, so a
 * prop cannot reach both. A tiny module-level `useSyncExternalStore` store,
 * the same shape `useSecondTick` already uses, is the simplest thing that
 * reaches every reader without inventing a new provider.
 *
 * This is intentionally NOT persisted and NOT part of `wellness.prefs`: it
 * is a per-tab "you have something to look at" flag, reset on reload, never
 * written to the server.
 */

import { useSyncExternalStore } from 'react'

export type ReminderSource = 'prayer' | 'wellness' | 'pomodoro'

let pending: Record<ReminderSource, boolean> = { prayer: false, wellness: false, pomodoro: false }
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

/**
 * Called by the reminder scheduling components (prayer, water/stretch,
 * pomodoro) whenever a reminder fires -- whether it toasts immediately or
 * queues because an attempt is active (R6.4) -- so a badge can appear even
 * where the full card is not on screen (the dock is collapsed, or hidden
 * entirely).
 */
export function setReminderPending(source: ReminderSource, value: boolean): void {
  if (pending[source] === value) return
  pending = { ...pending, [source]: value }
  notify()
}

/** Called once the learner acknowledges the badge: expanding the dock, or
 *  clicking the header's re-open glyph while the dock is hidden. */
export function clearReminderBadge(): void {
  if (!pending.prayer && !pending.wellness && !pending.pomodoro) return
  pending = { prayer: false, wellness: false, pomodoro: false }
  notify()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): boolean {
  return pending.prayer || pending.wellness || pending.pomodoro
}

function getServerSnapshot(): boolean {
  return false
}

/** Whether any source has an unacknowledged reminder pending right now. */
export function useReminderBadge(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/** Test-only: resets the module-level store between tests. */
export function resetReminderBadgeForTests(): void {
  pending = { prayer: false, wellness: false, pomodoro: false }
}
