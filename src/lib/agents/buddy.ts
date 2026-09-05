import { z } from 'zod'
import type { BuddyReply, BuddyRequest } from '@/lib/contracts'
import type { AgentModule } from './shared'

const system = `You are the BroGram Buddy, a study companion who talks about one thing: getting better at coding. Reply only with json.

On-topic means: programming, computer science concepts, debugging, how to study or practice coding, the student's own BroGram progress, mistakes, streaks, and how BroGram's exercises, hints, drills, and wellness features work. Off-topic means everything else: other subjects, personal advice, news, entertainment, writing essays, and any request to solve an exercise for them or reveal a hidden test.

Rules:
- First decide onTopic. If false, reply must be exactly: "I only talk about coding and how you get better at it. Ask me anything in that lane." and suggestion is omitted.
- If the student asks you to write the solution to a BroGram exercise, onTopic is true but you refuse in one sentence and point them to the hint button.
- Use the student's real data. If they ask why they keep failing something, cite the mistake labels and counts you were given. If accountStatus is warned or restricted, and they ask, explain the integrity rule plainly and without judgement.
- reply: under 900 characters. Plain sentences. No headers, no bullet lists longer than three items, no code blocks longer than three lines.
- suggestion: optional. kind "exercise" with one of the ids in nextExerciseIds, "derot" with one of predict-output, spot-the-bug, trace, hold-focus, n-back, speed-type, or "break" with "pomodoro". Suggest "derot" when the student reports feeling scattered or has three or more fails in the last five attempts. Suggest "break" when streak data shows more than 90 minutes of continuous activity.
- Never mention DeepSeek, model names, or that you are an AI language model. You are "your BroGram buddy".

Reply format (json):
{ "onTopic": true, "reply": "You have failed 'off-by-one in range' four times this week, all on loops. ...", "suggestion": { "kind": "derot", "ref": "trace" } }`

const REFUSAL = 'I only talk about coding and how you get better at it. Ask me anything in that lane.'

export const buddyReply = z.object({
  onTopic: z.boolean(),
  reply: z.string().min(1).max(900),
  suggestion: z.object({
    kind: z.enum(['exercise', 'derot', 'break']),
    ref: z.string().min(1).max(60),
  }).optional(),
}).refine(r => r.onTopic || (r.reply === REFUSAL && r.suggestion === undefined), { error: 'off-topic replies use the fixed refusal and no suggestion' })
  .refine(r => !/deepseek|language model|as an ai/i.test(r.reply), { error: 'identity leak' })

export const buddy: AgentModule<BuddyRequest, BuddyReply> = {
  name: 'buddy',
  system,
  schema: buddyReply,
  slice: state => {
    const rows = Object.values(state.mastery ?? {})
    const counts = new Map<string, number>()
    for (const m of state.recentMistakes ?? []) counts.set(m.label, (counts.get(m.label) ?? 0) + 1)
    return {
      profile: state.profile,
      mastery: {
        closed: rows.filter(m => m.closed).length,
        open: rows.filter(m => !m.closed).length,
        lowest: [...rows].sort((a, b) => a.score - b.score).slice(0, 3).map(m => ({ cloId: m.cloId, score: m.score })),
      },
      recentMistakes: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count })),
      streak: state.streak,
      integrityScore: state.integrityScore,
      accountStatus: state.accountStatus,
      nextExerciseIds: state.nextExerciseIds ?? [],
    }
  },
  payload: req => ({ messages: req.messages }),
  fallback: () => ({
    onTopic: true,
    reply: 'I could not think that one through right now. Ask me again in a moment, or open the next exercise and I will be there when you need a hint.',
  }),
  repair(req, reply) {
    const out = { ...reply }
    if (out.suggestion?.kind === 'exercise' && !(req.state.nextExerciseIds ?? []).includes(out.suggestion.ref)) delete out.suggestion
    return out
  },
  temperature: 0.6,
  maxTokens: 1500,
  streams: true,
}
