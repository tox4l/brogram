import { NextResponse } from 'next/server'
import { deepseek } from '@ai-sdk/deepseek'
import { generateObject, streamObject } from 'ai'
import type { AgentRequest } from '@/lib/contracts'
import { modules } from '@/lib/agents'
import { requestSchemas } from '@/lib/agents/requests'
import { buildMessages, BudgetExceeded } from '@/lib/agents/shared'
import { checkRate } from '@/lib/agents/ratelimit'
import { getUserAndProfile, serviceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
const MODEL = deepseek('deepseek-v4-flash')
// buildMessages puts the static system prompt first for DeepSeek prefix caching, and ai@7 refuses a
// system role inside `messages` without this; deepseek-v4-flash also has thinking on by default and
// spends reasoning tokens out of maxOutputTokens, which starves the 1,500-token agents of a reply.
const PROVIDER_CALL = {
  allowSystemInMessages: true,
  providerOptions: { deepseek: { thinking: { type: 'disabled' as const } } },
}
const cacheHits = (usage: { inputTokenDetails?: { cacheReadTokens?: number } }) => usage.inputTokenDetails?.cacheReadTokens ?? 0
const err = (agent: string, error: string, message: string, status: number) => NextResponse.json({ ok: false, agent, error, message }, { status })

export async function POST(req: Request) {
  const { user, profile } = await getUserAndProfile()
  if (!user || !profile) return err('unknown', 'invalid-request', 'not signed in', 401)
  if (profile.account_status === 'banned') return err('unknown', 'banned', 'account banned', 403)
  const raw = (await req.json().catch(() => null)) as { agent?: string } | null
  const mod = raw && modules[raw.agent as keyof typeof modules]
  if (!mod) return err('unknown', 'invalid-request', 'unknown agent', 400)
  const parsedReq = requestSchemas[mod.name].safeParse(raw)
  if (!parsedReq.success) return err(mod.name, 'invalid-request', parsedReq.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '), 400)
  const body = parsedReq.data as AgentRequest
  const rate = await checkRate(user.id, mod.name, body.trigger, (body as { exercise?: { id: string } }).exercise?.id)
  if (!rate.ok) return err(mod.name, 'rate-limited', rate.message, 429)

  // server-side hydration: anything the client may not hold comes from the bank with the service key
  const svc = serviceClient()
  const hydrated: Record<string, unknown> = {}
  if (mod.name === 'reviewer' || mod.name === 'diagnoser') {
    const { data } = await svc.from('exercises').select('reference_solution, tests').eq('id', (body as { exercise: { id: string } }).exercise.id).single()
    if (!data) return err(mod.name, 'invalid-request', 'unknown exercise', 400)
    hydrated.referenceSolution = data.reference_solution
    hydrated.tests = data.tests
  }
  if (mod.name === 'author') {
    const author = body as unknown as { exampleIds: string[]; parentExerciseId?: string; parent?: unknown }
    const ids = [...author.exampleIds, ...(author.parentExerciseId ? [author.parentExerciseId] : [])]
    const { data } = await svc.from('exercises').select('*').in('id', ids)
    hydrated.examples = (data ?? []).filter(r => author.exampleIds.includes(r.id))
    hydrated.parent = (data ?? []).find(r => r.id === author.parentExerciseId) ?? null
    // without the parent row the variant check cannot run, so the request is refused rather than waved through
    if (author.parentExerciseId && !hydrated.parent) return err(mod.name, 'invalid-request', 'unknown parent exercise', 400)
    // the variant route check compares against the parent the server loaded, never one the client sent
    author.parent = hydrated.parent
  }

  let built
  try { built = buildMessages(mod, body, hydrated) }
  catch (e) { if (e instanceof BudgetExceeded) return err(mod.name, 'budget-exceeded', e.message, 413); throw e }
  const { messages, promptTokens } = built
  const usage = { promptTokens, completionTokens: 0, cacheHitTokens: 0 }
  // supabase builders are lazy: the row only reaches the table when the builder is awaited
  const record = async (fallback: boolean) => {
    try { await svc.from('agent_usage').insert({ user_id: user.id, agent: mod.name, trigger: body.trigger, prompt_tokens: usage.promptTokens, completion_tokens: usage.completionTokens, cache_hit_tokens: usage.cacheHitTokens, fallback }) }
    catch { /* a usage row that will not write must never cost the student their reply */ }
  }
  const finish = (reply: unknown, fallback: boolean) => ({ ok: true as const, agent: mod.name, reply, usage, fallback })

  const repair = (object: unknown) => (mod.repair ? mod.repair(body, object) : object)

  const wantsStream = mod.streams && (req.headers.get('accept') ?? '').includes('text/event-stream')
  if (process.env.AGENT_DRY_RUN === 'true') {
    if (!mod.fallback) return err(mod.name, 'upstream', 'dry run: no fallback for this agent', 502)
    const env = finish(mod.fallback(body), true)
    return wantsStream ? sse([{ partial: repair(env.reply) }, { envelope: env }]) : NextResponse.json(env)
  }

  const finalize = (object: unknown) => {
    const reply = repair(object)
    const rc = mod.routeCheck ? mod.routeCheck(body, reply) : null
    return { reply, error: rc }
  }

  if (wantsStream) {
    // streaming agents never retry; the terminal frame carries the validated object or the fallback
    const result = streamObject({ model: MODEL, schema: mod.schema, messages, temperature: mod.temperature, maxOutputTokens: mod.maxTokens, ...PROVIDER_CALL })
    // a partial stream that throws leaves these two unobserved; the catch below is what answers the client
    result.object.catch(() => {})
    result.usage.catch(() => {})
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const send = (frame: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`))
        try {
          // repair first: a partial must never show the student something the final reply would strip
          for await (const partial of result.partialObjectStream) send({ partial: repair(partial) })
          const object = await result.object
          const u = await result.usage; usage.completionTokens = u.outputTokens ?? 0; usage.cacheHitTokens = cacheHits(u)
          const { reply, error } = finalize(object)
          const env = error ? finish(mod.fallback!(body), true) : finish(reply, false)
          await record(env.fallback); send({ envelope: env })
        } catch {
          const env = finish(mod.fallback!(body), true); await record(true); send({ envelope: env })
        } finally { controller.close() }
      },
    })
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } })
  }

  const once = async (extra?: string) => generateObject({ model: MODEL, schema: mod.schema, messages: extra ? [...messages, { role: 'user' as const, content: extra }] : messages, temperature: mod.temperature, maxOutputTokens: mod.maxTokens, ...PROVIDER_CALL })
  let obj: unknown = null, lastError = ''
  for (let attempt = 0; attempt < 2 && obj === null; attempt++) {
    try {
      const r = await once(attempt ? `Your previous reply failed validation: ${lastError}. Reply with valid json matching the schema.` : undefined)
      usage.completionTokens += r.usage.outputTokens ?? 0; usage.cacheHitTokens += cacheHits(r.usage)
      const { reply, error } = finalize(r.object)
      if (error) { lastError = error; continue }
      obj = reply
    } catch (e) { lastError = (e as Error)?.message ?? 'invalid json' }
  }
  if (obj === null) {
    if (!mod.fallback) { await record(true); return err(mod.name, 'upstream', lastError, 502) }
    const env = finish(mod.fallback(body), true); await record(true); return NextResponse.json(env)
  }
  if (mod.name === 'author') {
    // the route, not the client, writes the bank
    const e = (obj as { exercise: Record<string, unknown> }).exercise
    const parentExerciseId = (body as unknown as { parentExerciseId?: string }).parentExerciseId
    const { data, error } = await svc.from('exercises').insert({ clo_id: e.cloId, language: e.language, kind: e.kind, difficulty: e.difficulty, pattern: e.pattern, title: e.title, prompt: e.prompt, starter_code: e.starterCode, tests: e.tests, reference_solution: e.referenceSolution, origin: 'generated', parent_exercise_id: parentExerciseId ?? null, author_user_id: user.id, verified: false, tags: e.tags, fixture: e.fixture ?? null }).select('id').single()
    // an exercise the client cannot verify by id is worse than none: it would run tests against a row that is not there
    if (error || !data?.id) { await record(true); return err(mod.name, 'upstream', error?.message ?? 'the generated exercise could not be stored', 502) }
    obj = { exercise: { ...e, id: data.id } }
  }
  const env = finish(obj, false); await record(false); return NextResponse.json(env)
}

function sse(frames: unknown[]) {
  const body = frames.map(f => `data: ${JSON.stringify(f)}\n\n`).join('')
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } })
}
