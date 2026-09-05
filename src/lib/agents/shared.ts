import { z } from 'zod'
import type { AgentName, AgentRequest, LearnerProfile, LearnerState } from '@/lib/contracts'
import { AGENT_TOKEN_BUDGETS, AGENT_HARD_CEILING } from '@/lib/contracts'

export interface AgentModule<Req extends AgentRequest, Reply> {
  name: AgentName
  system: string                      // static, contains the word "json"
  schema: z.ZodType<Reply>
  slice(state: Partial<LearnerState>): Record<string, unknown>
  payload(req: Req, hydrated: Record<string, unknown>): Record<string, unknown>
  fallback?(req: Req): Reply          // absent for author
  repair?(req: Req, reply: Reply): Reply          // fixes, never fails; runs before routeCheck
  routeCheck?(req: Req, reply: Reply): string | null
  temperature: number
  maxTokens: number
  streams: boolean
}

export class BudgetExceeded extends Error { constructor(public used: number, public limit: number) { super(`prompt ${used} tokens over ${limit}`) } }

export const approxTokens = (s: string) => Math.ceil(s.length / 3.5)

const TONE: Record<string, string> = {
  playful: 'Be playful and light; a joke is welcome if it is short.',
  supportive: 'Be warm and encouraging; assume the student is trying hard.',
  'tough-love': 'Be blunt and demanding; no cushioning, no insults.',
  direct: 'Be neutral and precise; no small talk.',
}
export function toneSentences(p?: Partial<Pick<LearnerProfile, 'tone' | 'verbosity'>>): string {
  const tone = TONE[p?.tone ?? 'direct'] ?? TONE.direct
  const verb = (p?.verbosity ?? 'short') === 'short' ? 'Keep every field to one or two sentences.' : 'You may use up to four sentences per field where it helps.'
  return `${tone} ${verb}`
}

/** Cache-friendly order, trimmed to budget; throws BudgetExceeded when trimming cannot get under the limit. */
export function buildMessages(mod: AgentModule<AgentRequest, unknown>, req: AgentRequest, hydrated: Record<string, unknown>) {
  const slice = mod.slice(req.state)
  const payload = mod.payload(req, hydrated)
  const limit = Math.min(AGENT_TOKEN_BUDGETS[mod.name], AGENT_HARD_CEILING)
  const render = () => [
    { role: 'system' as const, content: mod.system },
    { role: 'user' as const, content: `Learner state (json):\n${JSON.stringify(slice)}\n\n${toneSentences((req.state as Partial<LearnerState>).profile)}\n\nInput (json):\n${JSON.stringify(payload)}` },
  ]
  const cap = (s: unknown, n: number) => (typeof s === 'string' && s.length > n ? s.slice(0, n) : s)
  // hard caps first; never trim the student's current code below 20k
  for (const k of ['code', 'currentCode']) if (k in payload) payload[k] = cap(payload[k], 20000)
  const trims: Array<() => boolean> = [
    () => { const rm = slice.recentMistakes; if (Array.isArray(rm) && rm.length) { rm.pop(); return true } return false },
    () => { const r = payload.results; if (Array.isArray(r)) { let did = false; for (const x of r) for (const k of ['stdout', 'stderr', 'actual']) if (typeof x[k] === 'string' && x[k].length > 200) { x[k] = x[k].slice(0, 200); did = true } return did } return false },
    () => { const m = payload.messages; if (Array.isArray(m) && m.length > 2) { m.shift(); return true } return false },
    () => { if (payload.parent) { delete payload.parent; return true } return false },
    () => { const ex = payload.examples; if (Array.isArray(ex) && ex.length > 1) { ex.pop(); return true } return false },
    () => { const d = payload.diffSinceLastHint; if (typeof d === 'string' && d.length > 2000) { payload.diffSinceLastHint = d.slice(0, 2000); return true } return false },
  ]
  let msgs = render()
  let used = approxTokens(msgs.map(m => m.content).join('\n'))
  while (used > limit) {
    if (!trims.some(t => t())) break
    msgs = render(); used = approxTokens(msgs.map(m => m.content).join('\n'))
  }
  if (used > limit) throw new BudgetExceeded(used, limit)
  return { messages: msgs, promptTokens: used }
}
