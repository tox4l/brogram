// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentError, CoachRequest, DiagnoserReply, DiagnoserRequest, ReviewerReply } from '@/lib/contracts'
import { callAgent, streamAgent } from './client'

const coachRequest: CoachRequest = {
  agent: 'coach',
  trigger: 'hint-requested',
  state: { userId: 'u1', version: 3 },
  exercise: { id: 'ex_1', cloId: 'c1', pattern: 'p', prompt: 'do it', language: 'python' },
  diffSinceLastHint: '',
  currentCode: 'pass',
  fixPlan: ['one'],
  hintsSoFar: [],
}

const diagnoserRequest: DiagnoserRequest = {
  agent: 'diagnoser',
  trigger: 'attempt-failed',
  state: { userId: 'u1', version: 3 },
  exercise: { id: 'ex_1', cloId: 'c1', pattern: 'p', prompt: 'do it', language: 'python', kind: 'code' },
  code: 'pass',
  results: [],
}

const reviewerEnvelope = {
  ok: true,
  agent: 'reviewer',
  reply: { improvements: ['a', 'b'], quality: 80, praise: 'good' } as ReviewerReply,
  usage: { promptTokens: 10, completionTokens: 5, cacheHitTokens: 0 },
  fallback: false,
}

const sseResponse = (chunks: string[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder()
        for (const c of chunks) controller.enqueue(encoder.encode(c))
        controller.close()
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('callAgent', () => {
  it('posts the request as json and returns the envelope', async () => {
    fetchMock.mockResolvedValue(Response.json(reviewerEnvelope))
    const envelope = await callAgent({ ...coachRequest, agent: 'coach' })
    expect(envelope.usage.promptTokens).toBe(10)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/agent')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.headers.Accept).toBeUndefined()
    expect(JSON.parse(init.body).agent).toBe('coach')
  })

  it('rejects with the agent error when the route refuses', async () => {
    const error: AgentError = { ok: false, agent: 'coach', error: 'rate-limited', message: 'one hint a minute' }
    fetchMock.mockResolvedValue(Response.json(error, { status: 429 }))
    await expect(callAgent(coachRequest)).rejects.toMatchObject({ ok: false, error: 'rate-limited' })
  })

  it('rejects with an upstream error when the body is not json', async () => {
    fetchMock.mockResolvedValue(new Response('gateway down', { status: 502 }))
    await expect(callAgent(coachRequest)).rejects.toMatchObject({ ok: false, agent: 'coach', error: 'upstream' })
  })
})

describe('streamAgent', () => {
  it('asks for a stream, reports partials and resolves with the envelope', async () => {
    const envelope = { ...reviewerEnvelope, agent: 'diagnoser', reply: { intent: 'You were going for it' } }
    fetchMock.mockResolvedValue(
      sseResponse([
        'data: {"partial":{"intent":"You were"}}\n\n',
        'data: {"partial":{"intent":"You were going for it"}}\n',
        `\ndata: ${JSON.stringify({ envelope })}\n\n`,
      ]),
    )
    const partials: Partial<DiagnoserReply>[] = []
    const result = await streamAgent(diagnoserRequest, p => partials.push(p))
    expect(fetchMock.mock.calls[0][1].headers.Accept).toBe('text/event-stream')
    expect(partials).toEqual([{ intent: 'You were' }, { intent: 'You were going for it' }])
    expect(result.reply).toEqual({ intent: 'You were going for it' })
  })

  it('rejects when the terminal frame carries an agent error', async () => {
    const envelope: AgentError = { ok: false, agent: 'diagnoser', error: 'upstream', message: 'no json twice' }
    fetchMock.mockResolvedValue(sseResponse([`data: ${JSON.stringify({ envelope })}\n\n`]))
    await expect(streamAgent(diagnoserRequest, () => {})).rejects.toMatchObject({ ok: false, error: 'upstream' })
  })

  it('rejects on a plain json refusal that never became a stream', async () => {
    const error: AgentError = { ok: false, agent: 'diagnoser', error: 'budget-exceeded', message: 'too big' }
    fetchMock.mockResolvedValue(Response.json(error, { status: 413 }))
    await expect(streamAgent(diagnoserRequest, () => {})).rejects.toMatchObject({ error: 'budget-exceeded' })
  })

  it('rejects when the stream ends without an envelope', async () => {
    fetchMock.mockResolvedValue(sseResponse(['data: {"partial":{"intent":"You were"}}\n\n']))
    await expect(streamAgent(diagnoserRequest, () => {})).rejects.toMatchObject({ error: 'upstream' })
  })
})
