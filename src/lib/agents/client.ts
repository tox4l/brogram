import type { AgentEnvelope, AgentError, AgentName, AgentReplyOf, AgentRequest } from '@/lib/contracts'

type RequestOf<A extends AgentName> = Extract<AgentRequest, { agent: A }>
type Frame<R> = { partial: Partial<R> } | { envelope: AgentEnvelope<R> | AgentError }

const ROUTE = '/api/agent'

const asError = (agent: AgentName, body: unknown): AgentError =>
  body && typeof body === 'object' && (body as AgentError).ok === false
    ? (body as AgentError)
    : { ok: false, agent, error: 'upstream', message: 'the agent route returned no usable reply' }

async function envelopeFromJson<A extends AgentName>(agent: A, res: Response): Promise<AgentEnvelope<AgentReplyOf<A>>> {
  const body = await res.json().catch(() => null)
  if (!body || body.ok !== true) throw asError(agent, body)
  return body as AgentEnvelope<AgentReplyOf<A>>
}

export async function callAgent<A extends AgentName>(req: RequestOf<A>): Promise<AgentEnvelope<AgentReplyOf<A>>> {
  const res = await fetch(ROUTE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  return envelopeFromJson(req.agent as A, res)
}

/** Renders partials optimistically; only the terminal envelope is worth committing. */
export async function streamAgent<A extends AgentName>(
  req: RequestOf<A>,
  onPartial: (partial: Partial<AgentReplyOf<A>>) => void,
): Promise<AgentEnvelope<AgentReplyOf<A>>> {
  const agent = req.agent as A
  const res = await fetch(ROUTE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(req),
  })
  if (!res.body || !(res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    return envelopeFromJson(agent, res)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let envelope: AgentEnvelope<AgentReplyOf<A>> | AgentError | null = null
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let cut = buffer.indexOf('\n\n')
    while (cut !== -1) {
      const frame = parseFrame<AgentReplyOf<A>>(buffer.slice(0, cut))
      buffer = buffer.slice(cut + 2)
      if (frame && 'partial' in frame) onPartial(frame.partial)
      else if (frame && 'envelope' in frame) envelope = frame.envelope
      cut = buffer.indexOf('\n\n')
    }
  }
  if (!envelope || envelope.ok !== true) throw asError(agent, envelope)
  return envelope
}

function parseFrame<R>(chunk: string): Frame<R> | null {
  const line = chunk.split('\n').find(l => l.startsWith('data:'))
  if (!line) return null
  try {
    return JSON.parse(line.slice(5).trim()) as Frame<R>
  } catch {
    return null
  }
}
