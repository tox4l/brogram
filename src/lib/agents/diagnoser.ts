import { z } from 'zod'
import type { DiagnoserReply, DiagnoserRequest } from '@/lib/contracts'
import type { AgentModule } from './shared'

const system = `You are the BroGram Diagnoser. A student just submitted code that failed some tests. You work out what they were trying to do, name the single root cause, and write a short fix plan they can follow without being given the code. Reply only with json.

You receive the exercise prompt, the student's code, the test results (which failed, actual versus expected, stderr), and the labels of their last five mistakes.

Rules:
- intent: one or two sentences starting with "You were going for" that describe the approach the student attempted, in plain words, as if you had watched them write it. Be specific to their code, not the task.
- rootCause: one sentence naming the single most important reason the tests fail. If there are several bugs, pick the one that blocks the most tests. Reference a line by quoting a short fragment of their code, not a line number.
- mistakeLabel: 2 to 6 words, lowercase, a reusable category such as "off-by-one in range", "mutating while iterating", "wrong join column", "missing base case", "event handler not attached". If one of the last five mistake labels fits, reuse it exactly so patterns can be counted.
- fixPlan: 3 to 6 steps. Each step is one imperative sentence the student can act on. Steps describe what to check or change and why, never the code itself. No step contains code longer than a single identifier or operator in backticks. The last step is always "Run the visible examples before you submit again."
- Never write the corrected code. Never give the final answer. Never say "simply".
- If the code has a syntax or compile error, rootCause names it and the fix plan starts with reading the error message.

Reply format (json):
{ "intent": "You were going for a loop that stops at the first late train.", "rootCause": "The loop returns \`-1\` inside the loop body, so it exits on the first element that is not late.", "mistakeLabel": "return inside loop body", "fixPlan": ["Trace the loop by hand with the first visible example and note when the return runs.", "Move the not-found return so it only runs after the loop finishes.", "Check the empty-list example: what should the function return when there is nothing to check?", "Run the visible examples before you submit again."] }`

const noCodeBlock = (s: string) => !/```/.test(s) && !/\n\s{2,}\S/.test(s)

export const diagnoserReply = z.object({
  intent: z.string().min(15).max(400).refine(s => s.startsWith('You were going for'), { error: 'intent must start with "You were going for"' }),
  rootCause: z.string().min(15).max(400).refine(noCodeBlock, { error: 'no code blocks' }),
  mistakeLabel: z.string().min(3).max(40).regex(/^[a-z0-9 \-]+$/, { error: 'lowercase words only' }),
  fixPlan: z.array(z.string().min(10).max(220).refine(noCodeBlock, { error: 'no code in steps' })).min(3).max(6)
    .refine(p => p[p.length - 1] === 'Run the visible examples before you submit again.', { error: 'last step is fixed' })
    .refine(p => !p.some(s => /\bsimply\b/i.test(s)), { error: 'no "simply"' }),
})

const FALLBACK: DiagnoserReply = {
  intent: 'You were going for a solution that handles the example, but at least one test still disagrees with it.',
  rootCause: 'The first failing test expected a different result than your code produced; compare the actual and expected values shown.',
  mistakeLabel: 'unclassified',
  fixPlan: [
    "Read the first failing test's expected value and say out loud what input produced it.",
    'Trace your code by hand with that exact input and write down every variable after each step.',
    'Find the first step where your trace and the expected value disagree.',
    'Run the visible examples before you submit again.',
  ],
}

export const diagnoser: AgentModule<DiagnoserRequest, DiagnoserReply> = {
  name: 'diagnoser',
  system,
  schema: diagnoserReply,
  slice: state => ({
    profile: { tone: state.profile?.tone, verbosity: state.profile?.verbosity },
    recentMistakes: (state.recentMistakes ?? []).slice(0, 5).map(m => m.label),
  }),
  payload: (req, hydrated) => ({
    exercise: req.exercise,
    code: req.code,
    results: req.results,
    tests: hydrated.tests,
    referenceSolution: hydrated.referenceSolution,
  }),
  fallback: () => ({ ...FALLBACK, fixPlan: [...FALLBACK.fixPlan] }),
  temperature: 0.6,
  maxTokens: 1500,
  streams: true,
}
