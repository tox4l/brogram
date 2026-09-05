import type { MistakeRecord } from '@/lib/contracts'

/** Learner State holds at most this many mistakes (spec section 5). */
export const MISTAKE_LIMIT = 10

/**
 * Newest first, deduplicated, capped.
 *
 * Called with the default limit when the state is compiled, and with a smaller
 * limit by the agent route when a prompt is over budget: shedding from the tail
 * drops the oldest mistake first, which is the order the spec asks for.
 */
export function trimMistakes(mistakes: MistakeRecord[], limit: number = MISTAKE_LIMIT): MistakeRecord[] {
  const seen = new Set<string>()
  const unique: MistakeRecord[] = []

  for (const mistake of [...mistakes].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))) {
    const key = `${mistake.exerciseId}|${mistake.at}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(mistake)
  }

  return unique.slice(0, Math.max(0, limit))
}
