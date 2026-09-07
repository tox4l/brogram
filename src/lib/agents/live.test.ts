// @vitest-environment node
//
// Exercises the real DeepSeek provider (deepseek-v4-flash, JSON mode via @ai-sdk/deepseek)
// through the profiler, planner and coach modules, calling generateObject / streamObject exactly
// the way src/app/api/agent/route.ts calls them (same model, schema, messages, temperature,
// maxOutputTokens) plus two things route.ts does not set today, both needed to get a real reply
// at the modules' configured maxOutputTokens (1500) rather than an SDK-level failure:
//   1. `allowSystemInMessages: true` -- the installed ai@7.0.93 throws AI_InvalidPromptError for
//      any `messages` array containing a system role unless this is set (default false), and
//      buildMessages always puts the module's system prompt first in `messages`.
//   2. `providerOptions: { deepseek: { thinking: { type: 'disabled' } } }` -- deepseek-v4-flash
//      has "thinking" (reasoning) enabled by default, and reasoning tokens are billed against and
//      consumed from the same maxOutputTokens budget. Confirmed by hand: profiler/planner's real
//      system prompts under the module's 1500-token cap reliably return
//      AI_NoObjectGeneratedError ("the model did not return a response") with thinking enabled,
//      and succeed once thinking is disabled. docs/research/runtime-facts.md already says
//      reasoning is "not needed for any of the seven agents at launch", so this only makes the
//      route match its own documented intent.
// route.ts does not set either option today, so real (non-mocked) traffic is at risk of both
// issues; that fix is out of this file's scope (not part of the reviewed/committed change here)
// and is called out in the build log instead.
// TI-1 (Wave 2 review, §4): this suite makes real, billed DeepSeek calls, and
// `npx vitest run` is the command every task's acceptance and every wave gate
// runs. Gating on DEEPSEEK_API_KEY alone silently spent tokens on any machine
// with a key in .env.local. Both halves below are load-bearing together: the
// suite requires an explicit opt-in, RUN_LIVE_AGENT_TESTS, and .env.local
// itself is only loaded (with the tiny parser below) once that opt-in is
// already set, so a plain `npx vitest run` / `npm test` cannot populate
// DEEPSEEK_API_KEY from the file at all — never mind reading it. To run this
// suite on purpose:
//   RUN_LIVE_AGENT_TESTS=1 npx vitest run src/lib/agents/live.test.ts
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { deepseek } from '@ai-sdk/deepseek'
import { generateObject, streamObject } from 'ai'
import type { BuddyRequest, Clo, CoachRequest, DiagnoserRequest, PlannerRequest, ProfilerRequest } from '@/lib/contracts'
import { buildMessages } from './shared'
import { profiler } from './profiler'
import { planner } from './planner'
import { coach } from './coach'
import { diagnoser } from './diagnoser'
import { buddy } from './buddy'
import closSeed from '../../../seed/clos.json'

function loadDotEnvLocal() {
  let text: string
  try { text = readFileSync('.env.local', 'utf8') } catch { return }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()
    if (key && process.env[key] === undefined) process.env[key] = value
  }
}
if (process.env.RUN_LIVE_AGENT_TESTS) loadDotEnvLocal()

const MODEL = deepseek('deepseek-v4-flash')
// see the file header: thinking is on by default and its tokens eat the module's maxOutputTokens budget
const NO_THINKING = { deepseek: { thinking: { type: 'disabled' as const } } }

type ProviderUsage = { inputTokens?: number; outputTokens?: number; inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number } }
const logUsage = (agent: string, usage: ProviderUsage) => {
  console.info(`${agent} usage:`, JSON.stringify({
    promptTokens: usage.inputTokens,
    completionTokens: usage.outputTokens,
    cacheHitTokens: usage.inputTokenDetails?.cacheReadTokens,
    cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens,
  }))
}

describe.skipIf(!process.env.RUN_LIVE_AGENT_TESTS || !process.env.DEEPSEEK_API_KEY)('live DeepSeek JSON mode', () => {
  it('profiler answers phase 1 with a schema-valid next question', async () => {
    const req: ProfilerRequest = {
      agent: 'profiler',
      trigger: 'onboarding-answer',
      state: { userId: 'live-check-1', version: 1 },
      phase: 1,
      answers: [{ questionId: 'p1f1', answer: 'A diagram showing how the loop moves through the list' }],
    }
    const { messages } = buildMessages(profiler, req, {})
    const result = await generateObject({ model: MODEL, schema: profiler.schema, messages, temperature: profiler.temperature, maxOutputTokens: profiler.maxTokens, allowSystemInMessages: true, providerOptions: NO_THINKING })

    let reply: unknown = result.object
    if (profiler.repair) reply = profiler.repair(req, reply as never)
    if (profiler.routeCheck) expect(profiler.routeCheck(req, reply as never)).toBeNull()
    expect(() => profiler.schema.parse(reply)).not.toThrow()

    console.info('profiler reply:', JSON.stringify(reply))
    logUsage('profiler', result.usage)
    expect(result.usage.outputTokens).toBeGreaterThan(0)
  }, 60000)

  it("planner orders INFS1101's four CLOs and picks from six fabricated candidates", async () => {
    const clos: Clo[] = closSeed.clos
      .filter(c => c.course === 'INFS1101')
      .map(c => ({
        id: c.id,
        course: c.course,
        ordinal: c.ordinal,
        outcome: c.outcome,
        topics: c.topics,
        prerequisites: c.prerequisites,
        patterns: c.patterns,
        assessableInCode: c.assessable_in_code,
      }))
    expect(clos).toHaveLength(4)

    const req: PlannerRequest = {
      agent: 'planner',
      trigger: 'plan-refresh',
      state: {
        userId: 'live-check-1',
        version: 1,
        currentCourse: 'INFS1101',
        mastery: {
          'INFS1101-1': { userId: 'live-check-1', cloId: 'INFS1101-1', score: 100, chain: 3, patternsPassed: ['trace', 'predict-output', 'spec-to-steps'], closed: true, lastAttemptAt: '2026-09-01T09:00:00.000Z' },
          'INFS1101-2': { userId: 'live-check-1', cloId: 'INFS1101-2', score: 55, chain: 1, patternsPassed: ['accumulate'], closed: false, lastAttemptAt: '2026-09-04T09:00:00.000Z' },
        },
        recentMistakes: [
          { exerciseId: 'ex_9', cloId: 'INFS1101-3', pattern: 'early-return', label: 'return -1 fires before the loop checks every element', at: '2026-09-05T09:00:00.000Z' },
        ],
      },
      course: 'INFS1101',
      clos,
      candidates: [
        { id: 'ex_c1', cloId: 'INFS1101-1', pattern: 'spec-to-steps', difficulty: 2, title: 'Order of operations' },
        { id: 'ex_c2', cloId: 'INFS1101-2', pattern: 'accumulate', difficulty: 3, title: 'Running total' },
        { id: 'ex_c3', cloId: 'INFS1101-3', pattern: 'early-return', difficulty: 3, title: 'First late train' },
        { id: 'ex_c4', cloId: 'INFS1101-3', pattern: 'guard', difficulty: 2, title: 'Skip the blanks' },
        { id: 'ex_c5', cloId: 'INFS1101-4', pattern: 'string-parse', difficulty: 3, title: 'Split the ticket' },
        { id: 'ex_c6', cloId: 'INFS1101-4', pattern: 'search', difficulty: 4, title: 'Find the duplicate' },
      ],
    }
    const { messages } = buildMessages(planner, req, {})
    const result = await generateObject({ model: MODEL, schema: planner.schema, messages, temperature: planner.temperature, maxOutputTokens: planner.maxTokens, allowSystemInMessages: true, providerOptions: NO_THINKING })

    let reply: unknown = result.object
    if (planner.repair) reply = planner.repair(req, reply as never)
    if (planner.routeCheck) expect(planner.routeCheck(req, reply as never)).toBeNull()
    expect(() => planner.schema.parse(reply)).not.toThrow()

    console.info('planner reply:', JSON.stringify(reply))
    logUsage('planner', result.usage)
    expect(result.usage.outputTokens).toBeGreaterThan(0)
  }, 60000)

  it('coach streams one hint for a failed "First late train" attempt', async () => {
    const req: CoachRequest = {
      agent: 'coach',
      trigger: 'hint-requested',
      state: { userId: 'live-check-1', version: 1 },
      exercise: {
        id: 'ex_c3',
        cloId: 'INFS1101-3',
        pattern: 'early-return',
        prompt: 'Given a list of train departure times and a limit, return the first time strictly after limit, or -1 if none exists. Example: first_late([8, 9, 13], 10) returns 13.',
        language: 'python',
      },
      diffSinceLastHint: '@@ -1,2 +1,2 @@\n-    return -1\n+    return -1\n',
      currentCode: 'def first_late(times, limit):\n    return -1\n',
      fixPlan: [
        'Loop through times in order instead of returning immediately.',
        'Inside the loop, return the first time greater than limit; only return -1 after the loop finishes.',
      ],
      hintsSoFar: [],
    }
    const { messages } = buildMessages(coach, req, {})
    const result = streamObject({ model: MODEL, schema: coach.schema, messages, temperature: coach.temperature, maxOutputTokens: coach.maxTokens, allowSystemInMessages: true, providerOptions: NO_THINKING })

    const partials: unknown[] = []
    for await (const partial of result.partialObjectStream) partials.push(partial)
    const object = await result.object
    const usage = await result.usage

    let reply: unknown = object
    if (coach.repair) reply = coach.repair(req, reply as never)
    expect(() => coach.schema.parse(reply)).not.toThrow()

    console.info('coach partial count:', partials.length)
    console.info('coach reply:', JSON.stringify(reply))
    logUsage('coach', usage)
    expect(usage.outputTokens).toBeGreaterThan(0)
  }, 60000)

  it('diagnoser explains a failed "First late train" attempt', async () => {
    const req: DiagnoserRequest = {
      agent: 'diagnoser',
      trigger: 'attempt-failed',
      state: { userId: 'live-check-1', version: 1 },
      exercise: {
        id: 'ex_c3',
        cloId: 'INFS1101-3',
        pattern: 'early-return',
        prompt: 'Given a list of train departure times and a limit, return the first time strictly after limit, or -1 if none exists. Example: first_late([8, 9, 13], 10) returns 13.',
        language: 'python',
        kind: 'code',
      },
      code: 'def first_late(times, limit):\n    return -1\n',
      results: [
        { testId: 't1', passed: false, actual: '-1', expected: '13', stdout: '', stderr: '', durationMs: 2, failureKind: 'wrong-answer' },
      ],
    }
    const hydrated = {
      tests: [{ id: 't1', input: '[[8,9,13],10]', expected: '13', hidden: false }],
      referenceSolution: 'def first_late(times, limit):\n    for t in times:\n        if t > limit:\n            return t\n    return -1\n',
    }
    const { messages } = buildMessages(diagnoser, req, hydrated)
    const result = streamObject({ model: MODEL, schema: diagnoser.schema, messages, temperature: diagnoser.temperature, maxOutputTokens: diagnoser.maxTokens, allowSystemInMessages: true, providerOptions: NO_THINKING })

    const partials: unknown[] = []
    for await (const partial of result.partialObjectStream) partials.push(partial)
    const object = await result.object
    const usage = await result.usage

    let reply: unknown = object
    if (diagnoser.repair) reply = diagnoser.repair(req, reply as never)
    expect(() => diagnoser.schema.parse(reply)).not.toThrow()

    console.info('diagnoser partial count:', partials.length)
    console.info('diagnoser reply:', JSON.stringify(reply))
    logUsage('diagnoser', usage)
    expect(usage.outputTokens).toBeGreaterThan(0)
  }, 60000)

  it('buddy answers a real question about failing loops on the tightest streaming budget', async () => {
    const req: BuddyRequest = {
      agent: 'buddy',
      trigger: 'buddy-message',
      state: {
        userId: 'live-check-1',
        version: 1,
        profile: { tone: 'playful', verbosity: 'short' } as never,
        mastery: {
          'INFS1101-1': { userId: 'live-check-1', cloId: 'INFS1101-1', score: 90, chain: 3, patternsPassed: ['accumulate'], closed: true, lastAttemptAt: '2026-09-01T09:00:00.000Z' },
          'INFS1101-3': { userId: 'live-check-1', cloId: 'INFS1101-3', score: 24, chain: 0, patternsPassed: [], closed: false, lastAttemptAt: '2026-09-05T09:00:00.000Z' },
        },
        recentMistakes: [
          { exerciseId: 'ex_1', cloId: 'INFS1101-3', pattern: 'early-return', label: 'off-by-one in range', at: '2026-09-05T10:00:00.000Z' },
          { exerciseId: 'ex_2', cloId: 'INFS1101-3', pattern: 'early-return', label: 'off-by-one in range', at: '2026-09-05T11:00:00.000Z' },
        ],
        streak: { exerciseDays: 4, derotDays: 1, lastExerciseDate: '2026-09-05', lastDerotDate: '2026-09-04' },
        integrityScore: 0,
        accountStatus: 'active',
        nextExerciseIds: ['ex_10', 'ex_11', 'ex_12'],
      },
      messages: [{ role: 'user', content: 'why do i keep failing loops' }],
    }
    const { messages } = buildMessages(buddy, req, {})
    const result = streamObject({ model: MODEL, schema: buddy.schema, messages, temperature: buddy.temperature, maxOutputTokens: buddy.maxTokens, allowSystemInMessages: true, providerOptions: NO_THINKING })

    const partials: unknown[] = []
    for await (const partial of result.partialObjectStream) partials.push(partial)
    const object = await result.object
    const usage = await result.usage

    let reply: unknown = object
    if (buddy.repair) reply = buddy.repair(req, reply as never)
    expect(() => buddy.schema.parse(reply)).not.toThrow()

    console.info('buddy partial count:', partials.length)
    console.info('buddy reply:', JSON.stringify(reply))
    logUsage('buddy', usage)
    expect(usage.outputTokens).toBeGreaterThan(0)
  }, 60000)
})
