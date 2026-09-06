import type { LearnerState } from '@/lib/contracts'

export const MAX_MESSAGES = 50
export const REFUSAL = 'I only talk about coding and how you get better at it. Ask me anything in that lane.'

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

export function suggestionHref(kind: 'exercise' | 'derot' | 'break', ref: string): string {
  if (kind === 'exercise') return `/exercise/${encodeURIComponent(ref)}`
  if (kind === 'derot') return `/derot?drill=${encodeURIComponent(ref)}`
  return '#pomodoro'
}

export function suggestionLabel(kind: 'exercise' | 'derot' | 'break'): string {
  if (kind === 'exercise') return 'Try the next exercise'
  if (kind === 'derot') return 'Try a de-rot drill'
  return 'Take a break'
}
