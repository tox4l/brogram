import type { LearnerState } from '@/lib/contracts'
import { REFUSAL } from '@/lib/agents/buddy'

export const MAX_MESSAGES = 50
export { REFUSAL }

export interface BuddyMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  suggestion?: { kind: 'exercise' | 'derot' | 'break'; ref: string }
}

/** Keeps the local list at 50, dropping the oldest first. */
export function capMessages(messages: BuddyMessage[]): BuddyMessage[] {
  return messages.length > MAX_MESSAGES ? messages.slice(messages.length - MAX_MESSAGES) : messages
}

/** The only slice keys src/lib/agents/buddy.ts accepts from the client. */
export function buddyStateSlice(state: LearnerState) {
  return {
    userId: state.userId,
    version: state.version,
    profile: state.profile,
    mastery: state.mastery,
    recentMistakes: state.recentMistakes,
    streak: state.streak,
    integrityScore: state.integrityScore,
    accountStatus: state.accountStatus,
    nextExerciseIds: state.nextExerciseIds,
  }
}

const onExercisePage = (pathname: string | null | undefined): boolean =>
  pathname === '/exercise' || (pathname?.startsWith('/exercise/') ?? false)

/**
 * `break` points at the pomodoro card's `id="pomodoro"` anchor. On an exercise page the wellness
 * rail renders as the compact strip, but the fragment still routes there through the dashboard
 * rather than assuming the compact strip is the right landing spot.
 */
export function suggestionHref(kind: 'exercise' | 'derot' | 'break', ref: string, pathname?: string | null): string {
  if (kind === 'exercise') return `/exercise/${encodeURIComponent(ref)}`
  if (kind === 'derot') return `/derot?drill=${encodeURIComponent(ref)}`
  return onExercisePage(pathname) ? '/dashboard#pomodoro' : '#pomodoro'
}

export function suggestionLabel(kind: 'exercise' | 'derot' | 'break'): string {
  if (kind === 'exercise') return 'Try the next exercise'
  if (kind === 'derot') return 'Try a de-rot drill'
  return 'Take a break'
}

/**
 * The break chip's target is an anchor on the current page (or a same-app navigation to it), so
 * the drawer must close first or it keeps the pomodoro card it just scrolled to hidden behind it.
 * Exercise and derot chips route to a different screen, where closing the drawer first is not
 * load-bearing, so this only fires for `break`.
 */
export function handleSuggestionClick(kind: 'exercise' | 'derot' | 'break', onOpenChange: (open: boolean) => void): void {
  if (kind === 'break') onOpenChange(false)
}
