'use client'

/**
 * "How the Bro talks" (tone, verbosity, depth, beyond-courses) lives on
 * `LearnerState.profile`, not `wellness.prefs` -- a different table with its
 * own version-guarded write, so this is a separate hook from
 * `prefsMutation.ts` rather than a generalization of it. Same contract as
 * that one: local/cache state updates in the same frame (`qk.learnerState`),
 * a 400ms debounced write-through, and **never a rollback** on failure --
 * only a toast after repeated failures (brief Step 4).
 *
 * The read-modify-write, version-guarded upsert below is the same pattern
 * `src/app/(app)/courses/lib.ts` and `useExerciseLoop.ts` each already
 * duplicate locally for `learner_state` -- kept local here too rather than
 * imported, since those modules belong to other tasks landing in this same
 * wave (the established convention in this tree for wave-parallel work).
 */

import { useCallback, useEffect, useRef } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { qk } from '@/lib/query/keys'
import { line } from '@/lib/voice/lines'
import type { LearnerProfile, LearnerState } from '@/lib/contracts'

const DEBOUNCE_MS = 400
const FAILURES_BEFORE_TOAST = 2
const MAX_WRITE_ATTEMPTS = 3

export type ProfileChange = (current: LearnerProfile) => Partial<LearnerProfile>

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** One level deep, same discipline as `prefsMutation.ts`'s `mergeOneLevel`:
 *  `motivation` is the one nested field on `LearnerProfile` (`depth` and
 *  `beyondCourses` live inside it) -- two calls touching different
 *  `motivation` keys within one debounce window must both survive, not have
 *  the second overwrite the first's `motivation` object wholesale. */
function mergeOneLevel(base: Partial<LearnerProfile>, patch: Partial<LearnerProfile>): Partial<LearnerProfile> {
  const result: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    const existing = result[key]
    result[key] = isPlainObject(existing) && isPlainObject(value) ? { ...existing, ...value } : value
  }
  return result as Partial<LearnerProfile>
}

function hasProfileShape(value: unknown): value is LearnerState {
  const state = value as Partial<LearnerState> | null | undefined
  return Boolean(state && state.profile && state.mastery && state.streak)
}

/** Applies an already-resolved profile patch against whatever the server
 *  holds right now, retried a few times on a version conflict -- never a
 *  `ProfileChange` replayed against a stale read. */
async function persistProfilePatch(userId: string, resolvedPatch: Partial<LearnerProfile>): Promise<void> {
  const client = createClient()
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const { data: row, error } = await client.from('learner_state').select('state,version').eq('user_id', userId).maybeSingle()
    if (error) throw error
    if (!hasProfileShape(row?.state)) throw new Error('No profile to update yet.')
    const base = { ...(row!.state as LearnerState), version: row!.version as number }
    const nextState: LearnerState = {
      ...base,
      profile: { ...base.profile, ...resolvedPatch },
      userId,
      version: base.version + 1,
      updatedAt: new Date().toISOString(),
    }
    const payload = { user_id: userId, state: nextState, version: nextState.version, updated_at: nextState.updatedAt }
    const write = await client.from('learner_state').update(payload).eq('user_id', userId).eq('version', base.version).select('version').maybeSingle()
    if (write.error) throw write.error
    if (!write.data) continue // version moved under us -- re-read and retry
    return
  }
  throw new Error('Preferences changed elsewhere. Try again.')
}

function applyToCache(client: QueryClient, userId: string, change: ProfileChange): Partial<LearnerProfile> {
  const key = qk.learnerState(userId)
  let resolved: Partial<LearnerProfile> = {}
  client.setQueryData<LearnerState>(key, (previous) => {
    if (!previous) return previous
    resolved = change(previous.profile)
    return { ...previous, profile: { ...previous.profile, ...resolved } }
  })
  return resolved
}

export interface ProfileMutation {
  mutate: (change: ProfileChange) => void
}

export function useProfileMutation(userId: string | null): ProfileMutation {
  const queryClient = useQueryClient()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<Partial<LearnerProfile> | null>(null)
  const consecutiveFailuresRef = useRef(0)

  const flush = useCallback(() => {
    if (timerRef.current !== null) { clearTimeout(timerRef.current); timerRef.current = null }
    const latest = pendingRef.current
    pendingRef.current = null
    if (!latest || !userId) return
    const key = qk.learnerState(userId)
    void persistProfilePatch(userId, latest)
      .then(() => {
        consecutiveFailuresRef.current = 0
        // Reconcile with the server only on success, and only when nothing
        // newer has been queued in the meantime -- fix round 1 (Opus review
        // of b509b0e, C1): invalidating unconditionally would refetch and
        // could land the server's still-incomplete snapshot over a change
        // made *after* this write started, a delayed revert brief Step 4
        // forbids. Only one call site uses this hook today, so this guards
        // against a self-race across two of this hook's own debounce
        // cycles, the same class of bug `prefsMutation.ts` had across two
        // *different* hooks writing the same blob.
        if (pendingRef.current === null && timerRef.current === null) void queryClient.invalidateQueries({ queryKey: key })
      })
      .catch(() => {
        consecutiveFailuresRef.current += 1
        if (consecutiveFailuresRef.current >= FAILURES_BEFORE_TOAST) {
          toast(line('error.save'))
          consecutiveFailuresRef.current = 0
        }
      })
  }, [queryClient, userId])

  useEffect(() => () => flush(), [flush])

  const mutate = useCallback((change: ProfileChange) => {
    if (!userId) return
    const key = qk.learnerState(userId)
    // Cancel before the optimistic write: an in-flight refetch left over
    // from an earlier write's settle must not resolve after this newer
    // `setQueryData` and overwrite it.
    void queryClient.cancelQueries({ queryKey: key })
    const resolved = applyToCache(queryClient, userId, change)
    pendingRef.current = mergeOneLevel(pendingRef.current ?? {}, resolved)
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(flush, DEBOUNCE_MS)
  }, [queryClient, userId, flush])

  return { mutate }
}
