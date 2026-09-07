import { z } from 'zod'
import type { CoachReply, CoachRequest } from '@/lib/contracts'
import type { AgentModule } from './shared'

const system = `You're the bro sitting next to them while they fix it — pointing at the next thing to look at, never typing it for them. A student is working through a failed exercise; you give exactly one hint and you never write the solution. Reply only with json.

You receive the exercise prompt, the student's current code, a diff of what they changed since the last hint, the fix plan the Diagnoser wrote, and the hints already given.

Rules:
- hint: one to three sentences. Point at the NEXT thing to look at, not the answer. Refer to the student's own code by quoting a short fragment in backticks. If the diff shows they moved in the right direction, say so first in five words or fewer, then hint.
- planStep: the 1-based index of the fix-plan step this hint serves. Never skip ahead more than one step from the last hint's planStep.
- codeLine: optional. At most ONE line, under 80 characters, no newline, and it must be a fragment (an expression, a condition, a signature), never a complete statement that solves the step. Omit it entirely for the first two hints of an exercise.
- Never repeat a previous hint. If every remaining step has been hinted, the hint says which visible example to trace by hand.
- Never mention tests the student cannot see. Never say "simply", "just", or "obviously".

Reply format (json):
{ "hint": "Good move on the loop. Now look at \`return -1\` and ask: does it run before the loop has seen every element?", "planStep": 2 }`

export const coachReply = z.object({
  hint: z.string().min(15).max(420)
    .refine(s => !/```/.test(s), { error: 'no code blocks' })
    .refine(s => !/\b(simply|just|obviously)\b/i.test(s), { error: 'banned words' }),
  planStep: z.number().int().min(1).max(6),
  codeLine: z.string().max(79).refine(s => !s.includes('\n'), { error: 'single line' })
    .refine(s => !/^\s*(def |class |function |return |for |while |if |SELECT |CREATE )/i.test(s) || s.length < 30, { error: 'fragment only' })
    .optional(),
})

export const coach: AgentModule<CoachRequest, CoachReply> = {
  name: 'coach',
  system,
  schema: coachReply,
  slice: state => ({ profile: { tone: state.profile?.tone, verbosity: state.profile?.verbosity } }),
  payload: req => ({
    exercise: req.exercise,
    diffSinceLastHint: req.diffSinceLastHint,
    currentCode: req.currentCode,
    fixPlan: req.fixPlan,
    hintsSoFar: req.hintsSoFar,
  }),
  fallback: () => ({
    hint: 'Pick the first visible example, run your code on it in your head, and write down the value of every variable at each step until it disagrees with the expected output.',
    planStep: 1,
  }),
  // also runs on half-streamed replies, so every field is treated as possibly absent
  repair(req, reply) {
    const out = { ...reply }
    if (req.hintsSoFar.length < 2) delete out.codeLine
    if (typeof out.planStep === 'number') out.planStep = Math.max(1, Math.min(out.planStep, req.hintsSoFar.length + 1, req.fixPlan.length))
    return out
  },
  temperature: 0.6,
  maxTokens: 1500,
  streams: true,
}
