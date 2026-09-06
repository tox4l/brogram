// @vitest-environment node
//
// The provider is mocked, so these run without an API key. They cover the paths the dry run
// cannot reach: the schema-failure retry, the two-failure fallback, routeCheck driving a retry,
// the Author insert, and the real streaming loop.
import { readFileSync } from 'node:fs'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentName } from '@/lib/contracts'

const db = vi.hoisted(() => {
  const state = {
    exerciseRows: [
      { id: 'bank_1', pattern: 'accumulate', title: 'One', prompt: 'p', starter_code: 's', tests: [], reference_solution: 'r' },
      { id: 'bank_2', pattern: 'count', title: 'Two', prompt: 'p', starter_code: 's', tests: [], reference_solution: 'r' },
    ],
    inserts: [] as { table: string; row: Record<string, unknown> }[],
    executed: [] as { table: string; op: string }[],
    insertError: null as { message: string } | null,
  }
  const client = {
    from(table: string) {
      const ctx = { op: '', head: false }
      const chain: unknown = new Proxy(
        {},
        {
          get(_target, prop: string) {
            if (prop === 'then') {
              state.executed.push({ table, op: ctx.op || 'select' })
              return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
                Promise.resolve(result()).then(resolve, reject)
            }
            return (...args: unknown[]) => {
              if (prop === 'insert') {
                ctx.op = 'insert'
                state.inserts.push({ table, row: args[0] as Record<string, unknown> })
              }
              if (prop === 'select' && (args[1] as { head?: boolean } | undefined)?.head) ctx.head = true
              if (prop === 'single') ctx.op = ctx.op === 'insert' ? 'insert-single' : 'single'
              return chain
            }
          },
        },
      )
      const result = () => {
        if (table === 'attempts') return { data: [{ hint_count: 0 }] }
        if (table === 'agent_usage') return ctx.head ? { count: 0 } : { data: null, error: null }
        if (ctx.op === 'insert-single') return state.insertError ? { data: null, error: state.insertError } : { data: { id: 'generated_1' }, error: null }
        if (ctx.op === 'single') return { data: { reference_solution: 'the real reference', tests: [] } }
        return { data: state.exerciseRows }
      }
      return chain
    },
  }
  return { state, client }
})

type Message = { role: string; content: string }
type Reply = { object: unknown } | { error: string }
type CallOptions = { messages: Message[]; allowSystemInMessages?: boolean; providerOptions?: { deepseek?: { thinking?: { type?: string } } } }

const ai = vi.hoisted(() => ({
  calls: [] as { messages: { role: string; content: string }[]; allowSystemInMessages?: boolean; providerOptions?: { deepseek?: { thinking?: { type?: string } } } }[],
  /** One entry per model call, consumed in order. */
  replies: [] as ({ object: unknown } | { error: string })[],
  partials: [] as unknown[],
  /** What the provider reports back; cacheReadTokens is what DeepSeek's prompt cache returns. */
  usage: { outputTokens: 12, inputTokenDetails: { cacheReadTokens: 1024 } },
}))

const nextReply = (options: CallOptions): Reply => {
  ai.calls.push(options)
  return ai.replies.shift() ?? { error: 'no reply configured for this call' }
}

vi.mock('@ai-sdk/deepseek', () => ({ deepseek: (modelId: string) => ({ modelId }) }))

vi.mock('ai', () => ({
  generateObject: async (options: CallOptions) => {
    const reply = nextReply(options)
    if ('error' in reply) throw new Error(reply.error)
    return { object: reply.object, usage: ai.usage }
  },
  streamObject: (options: CallOptions) => {
    const reply = nextReply(options)
    return {
      partialObjectStream: (async function* () {
        for (const partial of ai.partials) yield partial
      })(),
      object: 'error' in reply ? Promise.reject(new Error(reply.error)) : Promise.resolve(reply.object),
      usage: Promise.resolve(ai.usage),
    }
  },
}))

vi.mock('@/lib/supabase/server', () => ({
  getUserAndProfile: async () => ({ user: { id: 'u1' }, profile: { id: 'u1', account_status: 'active', restricted_until: null } }),
  serviceClient: () => db.client,
}))

const request = (agent: AgentName) =>
  JSON.parse(readFileSync(`src/lib/agents/fixtures/requests/${agent}.json`, 'utf8'))

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })

const route = () => import('./route')

const REVIEWER_REPLY = {
  improvements: ['`found` is never read after the loop.', 'The index in `range(len(x))` is never used.'],
  quality: 81,
  praise: 'You kept the early exit and the empty case honest.',
}
const PLANNER_REPLY = {
  path: ['INFS1101-1', 'INFS1101-2'],
  nextExerciseIds: ['ex_10', 'ex_11', 'ex_12'],
  focus: 'Loops that stop early, because your last three failures were all missing a break.',
}
const authorReply = () => ({ exercise: JSON.parse(readFileSync('src/lib/agents/fixtures/author/valid-python.json', 'utf8')).exercise })

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('AGENT_DRY_RUN', 'false')
  ai.calls = []
  ai.replies = []
  ai.partials = []
  db.state.inserts = []
  db.state.executed = []
  db.state.insertError = null
})

describe('POST /api/agent with a mocked provider', () => {
  // both proved necessary against the real provider: ai@7 refuses a system role in `messages`
  // without the first, and deepseek-v4-flash spends its reasoning tokens out of maxOutputTokens
  // without the second, leaving the 1,500-token agents with no object at all
  const expectProviderOptions = () => {
    expect(ai.calls.length).toBeGreaterThan(0)
    for (const call of ai.calls) {
      expect(call.allowSystemInMessages).toBe(true)
      expect(call.providerOptions?.deepseek?.thinking?.type).toBe('disabled')
      expect(call.messages[0].role).toBe('system')
    }
  }

  it('lets every generated call carry the system turn with thinking off', async () => {
    ai.replies = [{ error: 'bad json' }, { object: REVIEWER_REPLY }]
    const { POST } = await route()
    await POST(post(request('reviewer')))
    expect(ai.calls).toHaveLength(2)
    expectProviderOptions()
  })

  it('lets every streamed call carry the system turn with thinking off', async () => {
    const hint = 'Look again at where the loop ends and ask what runs before it finishes.'
    ai.partials = [{ hint }]
    ai.replies = [{ object: { hint, planStep: 2 } }]
    const { POST } = await route()
    await POST(post(request('coach'), { Accept: 'text/event-stream' })).then(r => r.text())
    expect(ai.calls).toHaveLength(1)
    expectProviderOptions()
  })

  it('reports the prompt-cache hits the provider measured, on both paths', async () => {
    ai.replies = [{ object: REVIEWER_REPLY }]
    const { POST } = await route()
    const body = await (await POST(post(request('reviewer')))).json()
    expect(body.usage.cacheHitTokens).toBe(1024)
    expect(db.state.inserts.find(i => i.table === 'agent_usage')?.row).toMatchObject({ cache_hit_tokens: 1024 })

    const hint = 'Look again at where the loop ends and ask what runs before it finishes.'
    ai.partials = [{ hint }]
    ai.replies = [{ object: { hint, planStep: 2 } }]
    const streamed = await POST(post(request('coach'), { Accept: 'text/event-stream' }))
    const frames = (await streamed.text()).split('\n\n').filter(Boolean).map(f => JSON.parse(f.replace('data: ', '')))
    expect(frames.at(-1).envelope.usage.cacheHitTokens).toBe(1024)
  })

  it('retries once with the validation message and keeps the second reply', async () => {
    ai.replies = [{ error: 'response did not match schema' }, { object: REVIEWER_REPLY }]
    const { POST } = await route()
    const body = await (await POST(post(request('reviewer')))).json()

    expect(ai.calls).toHaveLength(2)
    const retry = ai.calls[1].messages.at(-1)!
    expect(retry.role).toBe('user')
    expect(retry.content.startsWith('Your previous reply failed validation:')).toBe(true)
    expect(retry.content.endsWith('Reply with valid json matching the schema.')).toBe(true)
    expect(retry.content).toContain('response did not match schema')
    expect(ai.calls[0].messages).toHaveLength(ai.calls[1].messages.length - 1)
    expect(body).toMatchObject({ ok: true, agent: 'reviewer', fallback: false })
    expect(body.reply).toEqual(REVIEWER_REPLY)
    // a call that throws carries no usage, so only the second reply's tokens are billed
    expect(body.usage.completionTokens).toBe(12)
  })

  it('falls back after the second reply fails too', async () => {
    ai.replies = [{ error: 'bad json' }, { error: 'bad json again' }]
    const { POST } = await route()
    const res = await POST(post(request('reviewer')))
    const body = await res.json()
    expect(ai.calls).toHaveLength(2)
    expect(body).toMatchObject({ ok: true, fallback: true })
    expect(body.reply.quality).toBe(70)
    expect(db.state.inserts.find(i => i.table === 'agent_usage')?.row).toMatchObject({ fallback: true })
    expect(db.state.executed).toContainEqual({ table: 'agent_usage', op: 'insert' })
  })

  it('gives the author an upstream error rather than a fallback exercise', async () => {
    ai.replies = [{ error: 'bad json' }, { error: 'bad json again' }]
    const { POST } = await route()
    const res = await POST(post(request('author')))
    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toMatchObject({ ok: false, agent: 'author', error: 'upstream', message: 'bad json again' })
    expect(db.state.inserts.find(i => i.table === 'exercises')).toBeUndefined()
  })

  it('retries when the first reply passes Zod but fails the route check', async () => {
    ai.replies = [{ object: { ...PLANNER_REPLY, nextExerciseIds: ['ex_99'] } }, { object: PLANNER_REPLY }]
    const { POST } = await route()
    const body = await (await POST(post(request('planner')))).json()
    expect(ai.calls).toHaveLength(2)
    expect(ai.calls[1].messages.at(-1)!.content).toContain('ex_99')
    expect(body).toMatchObject({ ok: true, fallback: false })
    expect(body.reply.nextExerciseIds).toEqual(['ex_10', 'ex_11', 'ex_12'])
    // both calls answered, so both are billed
    expect(body.usage.completionTokens).toBe(24)
  })

  it('writes the generated exercise to the bank and answers with its new id', async () => {
    ai.replies = [{ object: authorReply() }]
    const { POST } = await route()
    const body = await (await POST(post({ ...request('author'), parentExerciseId: 'bank_2' }))).json()
    expect(ai.calls).toHaveLength(1)
    expect(body.reply.exercise.id).toBe('generated_1')
    expect(db.state.inserts.find(i => i.table === 'exercises')?.row).toMatchObject({
      clo_id: 'INFS1101-3',
      origin: 'generated',
      parent_exercise_id: 'bank_2',
      author_user_id: 'u1',
      verified: false,
    })
  })

  it('refuses when the generated exercise cannot be stored', async () => {
    ai.replies = [{ object: authorReply() }]
    db.state.insertError = { message: 'duplicate key value violates unique constraint' }
    const { POST } = await route()
    const res = await POST(post(request('author')))
    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toMatchObject({ ok: false, agent: 'author', error: 'upstream' })
    expect(db.state.inserts.find(i => i.table === 'agent_usage')?.row).toMatchObject({ fallback: true })
    expect(db.state.executed.filter(e => e.table === 'agent_usage' && e.op === 'insert')).toHaveLength(1)
  })

  it('never puts a code line on the wire that the repair would have removed', async () => {
    const hint = 'Look again at where the loop ends and ask what runs before it finishes.'
    ai.partials = [{ hint: 'Look again', codeLine: 't > limit' }, { hint, planStep: 3, codeLine: 't > limit' }]
    ai.replies = [{ object: { hint, planStep: 3, codeLine: 't > limit' } }]
    const { POST } = await route()
    const res = await POST(post({ ...request('coach'), hintsSoFar: [] }, { Accept: 'text/event-stream' }))
    const text = await res.text()

    expect(text).not.toContain('codeLine')
    expect(text).not.toContain('t > limit')
    const frames = text.split('\n\n').filter(Boolean).map(f => JSON.parse(f.replace('data: ', '')))
    expect(frames.at(-1).envelope).toMatchObject({ ok: true, agent: 'coach', fallback: false })
    expect(frames.at(-1).envelope.reply.codeLine).toBeUndefined()
  })

  it('streams every partial and then exactly one envelope', async () => {
    const hint = 'Look again at where the loop ends and ask what runs before it finishes.'
    ai.partials = [{ hint: 'Look again' }, { hint, planStep: 2 }]
    ai.replies = [{ object: { hint, planStep: 2 } }]
    const { POST } = await route()
    const res = await POST(post(request('coach'), { Accept: 'text/event-stream' }))
    const frames = (await res.text()).split('\n\n').filter(Boolean).map(f => JSON.parse(f.replace('data: ', '')))

    expect(frames).toHaveLength(3)
    expect(frames.slice(0, 2).every(f => 'partial' in f)).toBe(true)
    expect(frames[0].partial).toEqual({ hint: 'Look again' })
    expect(frames[2].envelope).toMatchObject({ ok: true, agent: 'coach', fallback: false })
    expect(frames[2].envelope.reply).toEqual({ hint, planStep: 2 })
    expect(db.state.executed.filter(e => e.table === 'agent_usage' && e.op === 'insert')).toHaveLength(1)
  })

  it('falls back on a streamed reply that never validates, without an unhandled rejection', async () => {
    ai.partials = [{ hint: 'Look again' }]
    ai.replies = [{ error: 'stream produced no valid object' }]
    const { POST } = await route()
    const res = await POST(post(request('coach'), { Accept: 'text/event-stream' }))
    const frames = (await res.text()).split('\n\n').filter(Boolean).map(f => JSON.parse(f.replace('data: ', '')))
    expect(frames.at(-1).envelope).toMatchObject({ ok: true, agent: 'coach', fallback: true })
    expect(db.state.executed.filter(e => e.table === 'agent_usage' && e.op === 'insert')).toHaveLength(1)
  })
})
