import type { LearnerProfile } from '@/lib/contracts'

/**
 * Last-resort durability for the completing write (Wave 1 gate finding I3): if
 * `onboarding/page.tsx` retries the `onboardingComplete` write once and it still fails, the
 * compiled profile is queued here, keyed by user id, and retried the very next time `/onboarding`
 * mounts, before any redirect decision — the same pattern
 * `src/components/lesson/progressSync.ts` already uses for `lesson_progress` rows. Its presence is
 * also the guard that stops the Profiler from ever being asked a second time for this account:
 * once queued, the account is treated as onboarded regardless of what the server row currently
 * says, and `/onboarding` never renders a question while a queue entry exists.
 */
const queueKey = (userId: string) => `brogram:onboarding-complete-queue:${userId}`

export function queueCompletion(userId: string, profile: LearnerProfile): void {
  try {
    window.localStorage.setItem(queueKey(userId), JSON.stringify(profile))
  } catch {
    // Storage may be disabled or unavailable (SSR, a private-mode quota, etc.); the session's own
    // onboardingComplete flag (already set before this is ever called) still stops this account
    // from being re-asked for the rest of this session.
  }
}

export function readQueuedCompletion(userId: string): LearnerProfile | null {
  try {
    const raw = window.localStorage.getItem(queueKey(userId))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as LearnerProfile) : null
  } catch {
    return null
  }
}

export function clearQueuedCompletion(userId: string): void {
  try {
    window.localStorage.removeItem(queueKey(userId))
  } catch {
    // Best-effort only.
  }
}
