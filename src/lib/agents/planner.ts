import { z } from 'zod'
import type { Clo, CloId, Mastery, PlannerReply, PlannerRequest } from '@/lib/contracts'
import type { AgentModule } from './shared'

const system = `You're the bro who's already run this course and knows exactly where students get stuck. You order a course's learning outcomes (CLOs) into a path for one student and pick their next three exercises from a list of candidates, straight and specific, never generic. Reply only with json.

You receive: the course's CLOs with prerequisites, the student's mastery per CLO (score 0-100, closed true/false, patternsPassed), their recent mistake labels, their motivation (depth: pass, understand, master), and a list of candidate exercises the app already fetched from the bank. You never invent exercises; you only choose ids from candidates.

Rules:
- path lists every CLO id of the course exactly once, prerequisites before dependents, closed CLOs last.
- nextExerciseIds has exactly 3 ids from candidates when at least 3 candidates exist, otherwise all of them. If candidates is empty, nextExerciseIds is [] and focus says the next exercises are still being prepared. Prefer the first open CLO in path. Prefer patterns the student has not passed for that CLO. Prefer difficulty 3 unless mastery.score for that CLO is below 30 (then 2) or the CLO's chain closed with zero hints last time (then 4).
- If recentMistakes shows the same label three or more times, put a candidate that targets that pattern first and say so in focus.
- depth "pass" means keep the student on the course's own CLOs; "master" means you may interleave a prerequisite CLO for reinforcement even if closed.
- focus is one sentence, under 140 characters, telling the student what this week is about. No exclamation marks.

Reply format (json):
{ "path": ["INFS1101-1", "INFS1101-2"], "nextExerciseIds": ["ex_1", "ex_2", "ex_3"], "focus": "Loops that stop early, because your last three failures were all missing a break." }`

export const plannerReply = z.object({
  path: z.array(z.string().min(1)).min(1),
  nextExerciseIds: z.array(z.string().min(1)).max(3),
  focus: z.string().min(10).max(140).refine(s => !s.includes('!'), { error: 'no exclamation marks' }),
})

const PREPARING = 'Your next exercises are still being prepared.'

/** Prerequisites first; among the CLOs that are ready, open ones before closed ones, then by ordinal. */
function orderClos(clos: Clo[], mastery: Record<CloId, Mastery>): CloId[] {
  const byId = new Map(clos.map(c => [c.id, c]))
  const remaining = new Set(byId.keys())
  const path: CloId[] = []
  while (remaining.size) {
    const ready = [...remaining].filter(id => (byId.get(id)?.prerequisites ?? []).every(p => !remaining.has(p)))
    const pool = ready.length ? ready : [...remaining]
    pool.sort((a, b) => {
      const closed = Number(mastery[a]?.closed ?? false) - Number(mastery[b]?.closed ?? false)
      return closed !== 0 ? closed : (byId.get(a)?.ordinal ?? 0) - (byId.get(b)?.ordinal ?? 0)
    })
    path.push(pool[0])
    remaining.delete(pool[0])
  }
  return path
}

export const planner: AgentModule<PlannerRequest, PlannerReply> = {
  name: 'planner',
  system,
  schema: plannerReply,
  // the 2,000 token budget is tight, so mastery is cut to the current course and to the four fields the rules use
  slice: state => ({
    profile: { motivation: state.profile?.motivation, learningStyle: state.profile?.learningStyle },
    mastery: Object.fromEntries(
      Object.entries(state.mastery ?? {})
        .filter(([cloId]) => !state.currentCourse || cloId.startsWith(`${state.currentCourse}-`))
        .map(([cloId, m]) => [cloId, { score: m.score, chain: m.chain, closed: m.closed, patternsPassed: m.patternsPassed }]),
    ),
    recentMistakes: (state.recentMistakes ?? []).map(m => m.label),
    currentCourse: state.currentCourse ?? null,
  }),
  payload: req => ({
    course: req.course,
    clos: req.clos.map(c => ({ id: c.id, ordinal: c.ordinal, prerequisites: c.prerequisites, patterns: c.patterns, outcome: c.outcome.slice(0, 120) })),
    candidates: req.candidates.map(c => ({ id: c.id, cloId: c.cloId, pattern: c.pattern, difficulty: c.difficulty, title: c.title.slice(0, 40) })),
  }),
  fallback(req) {
    const mastery = req.state.mastery ?? {}
    const path = orderClos(req.clos, mastery)
    const firstOpen = path.find(id => !mastery[id]?.closed) ?? path[0]
    const nextExerciseIds = req.candidates
      .filter(c => c.cloId === firstOpen)
      .sort((a, b) => Math.abs(a.difficulty - 3) - Math.abs(b.difficulty - 3))
      .slice(0, 3)
      .map(c => c.id)
    const outcome = req.clos.find(c => c.id === firstOpen)?.outcome ?? ''
    const next = `Next: ${outcome.slice(0, 100)}`.replace(/!/g, '.')
    return { path, nextExerciseIds, focus: nextExerciseIds.length && next.length >= 10 ? next : PREPARING }
  },
  routeCheck(req, reply) {
    const candidateIds = new Set(req.candidates.map(c => c.id))
    const unknown = reply.nextExerciseIds.find(id => !candidateIds.has(id))
    if (unknown) return `nextExerciseIds contains ${unknown}, which is not one of the candidates`
    const wanted = req.clos.map(c => c.id).sort()
    const got = [...reply.path].sort()
    if (wanted.length !== got.length || wanted.some((id, i) => id !== got[i])) return 'path must list every CLO of the course exactly once'
    return null
  },
  temperature: 0.3,
  maxTokens: 1500,
  streams: false,
}
