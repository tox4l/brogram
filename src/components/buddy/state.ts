import type { SupabaseClient } from '@supabase/supabase-js'
import type { DrillLane, LearnerState } from '@/lib/contracts'
import { isArcadeKind, isPlayKind } from '@/app/(app)/derot/lib'
import { REFUSAL } from '@/lib/agents/buddy'
import type { LineKey } from '@/lib/voice/lines'

export const MAX_MESSAGES = 50
export { REFUSAL }

export interface BuddyMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  /** Set on a user message whose round trip to the agent failed. The message is never
   *  removed -- it stays in place, retryable, exactly as it was typed (brief T2.11 step 2). */
  status?: 'failed'
  suggestion?: {
    kind: 'exercise' | 'derot' | 'break'
    ref: string
    /** Populated only for `kind: 'derot'` by `pickDerotLane`, once, when the message is
     *  created -- the lane the resolved `ref` actually lives in. */
    lane?: DrillLane
    /** The R7.6 framing line to show instead of the generic label, or omitted when
     *  neither context signal fired. */
    lineKey?: LineKey
  }
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
 *
 * `lane` only matters for `kind: 'derot'`: `'play'` deep-links straight at the Playground runner
 * (`/derot/play/<id>`, T2.9b) since that route needs no redirect. Arcade stays on the existing
 * `/derot?drill=<id>` deep link -- `DrillQueryRedirect` in `src/app/(app)/derot/page.tsx` already
 * resolves that query param to `/derot/arcade/<id>` for any arcade kind, and this is the frozen
 * shape an existing test pins, so the default (no `lane`, or `lane: 'arcade'`) must not change.
 */
export function suggestionHref(kind: 'exercise' | 'derot' | 'break', ref: string, pathname?: string | null, lane?: DrillLane): string {
  if (kind === 'exercise') return `/exercise/${encodeURIComponent(ref)}`
  if (kind === 'derot') return lane === 'play' ? `/derot/play/${encodeURIComponent(ref)}` : `/derot?drill=${encodeURIComponent(ref)}`
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

// ---------------------------------------------------------------------------
// R7.6 -- the de-rot suggestion picks a lane from context, as copy inside the
// existing reply (not a new trigger). The agent (src/lib/agents/buddy.ts,
// T2.10, frozen contract) only ever picks a ref from the six Arcade kinds --
// it has no notion of Playground -- so the LANE framing is decided here, on
// the client, from data the drawer already holds (`LearnerState`).
// ---------------------------------------------------------------------------

export interface DerotSuggestionContext {
  /** Reuses the exact signal that already triggers the agent's own derot suggestion
   *  (its system prompt: "three or more fails in the last five attempts"). */
  hardFailure: boolean
  /** Milliseconds since `LearnerState.updatedAt` -- the one timestamp every write to the
   *  learner's state touches, so it is the simplest "time since anything happened" the
   *  client already has, with no extra plumbing. */
  idleGapMs: number
}

/** Three or more entries in the most-recent-first, capped-at-10 `recentMistakes` list. */
const HARD_FAILURE_MISTAKE_COUNT = 3
/** "Long gap" per R7.6 -- a round, documented hour; the spec names no exact number. */
export const LONG_IDLE_GAP_MS = 60 * 60 * 1000
/** The one Playground game that cannot be failed (spec 7.9) -- literally "step off it". */
const DEFAULT_PLAY_REF = 'breathe'
/** A safe Arcade fallback if a future ref is ever neither an Arcade nor a Playground id. */
const DEFAULT_ARCADE_REF = 'predict-output'

export function derotContextFrom(state: LearnerState, now: number): DerotSuggestionContext {
  return {
    hardFailure: (state.recentMistakes ?? []).length >= HARD_FAILURE_MISTAKE_COUNT,
    idleGapMs: now - Date.parse(state.updatedAt),
  }
}

export interface DerotLaneSuggestion {
  lane: DrillLane
  ref: string
  /** Omitted when neither R7.6 context signal fired -- callers fall back to the generic label. */
  lineKey?: LineKey
}

/**
 * Picks which of R7.6's two framings applies, if either. A hard-failure run outranks a long idle
 * gap when both happen to be true at once -- it is the fresher, more specific signal, and the one
 * the learner is looking at the Buddy about right now. Neither signal firing keeps today's plain
 * behaviour: the ref's own natural lane, no special copy.
 */
export function pickDerotLane(ref: string, context: DerotSuggestionContext): DerotLaneSuggestion {
  if (context.hardFailure) {
    return { lane: 'play', ref: isPlayKind(ref) ? ref : DEFAULT_PLAY_REF, lineKey: 'buddy.suggest.play' }
  }
  if (context.idleGapMs >= LONG_IDLE_GAP_MS) {
    return { lane: 'arcade', ref: isArcadeKind(ref) ? ref : DEFAULT_ARCADE_REF, lineKey: 'buddy.suggest.arcade' }
  }
  return { lane: isPlayKind(ref) ? 'play' : 'arcade', ref }
}

// ---------------------------------------------------------------------------
// History -- read through TanStack Query so a reopened drawer paints from
// cache with no round trip (spec 5.2's pattern: `staleTime`/`gcTime` of
// `Infinity`, changed only by this module's own writes, never by a timer).
// ---------------------------------------------------------------------------

export const buddyMessagesKey = (userId: string) => ['buddy-messages', userId] as const

interface BuddyMessageRow {
  id: unknown
  role: unknown
  content: unknown
  created_at: unknown
}

function mapHistoryRow(row: BuddyMessageRow): BuddyMessage {
  return {
    id: String(row.id),
    role: row.role === 'assistant' ? 'assistant' : 'user',
    content: String(row.content),
    createdAt: String(row.created_at),
  }
}

/**
 * Never rejects -- a failed history load falls back to an empty conversation, exactly as before
 * this was a query (a `console.warn`, not a thrown error), so it never triggers TanStack Query's
 * retry/backoff and never blocks the drawer painting its empty state immediately.
 */
export async function fetchBuddyHistory(client: SupabaseClient, userId: string): Promise<BuddyMessage[]> {
  try {
    const { data } = await client
      .from('buddy_messages')
      .select('id,role,content,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50)
    const rows = [...((data as BuddyMessageRow[] | null) ?? [])].reverse()
    return rows.map(mapHistoryRow)
  } catch (historyError) {
    console.warn('Failed to load buddy history', historyError)
    return []
  }
}
