import type { Language } from '@/lib/contracts'
import { checkRate } from '@/lib/agents/ratelimit'
import { buildJavaSource } from '@/lib/runtimes/java-normalize'
import { getUserAndProfile } from '@/lib/supabase/server'

export const runtime = 'nodejs'

interface Submission {
  language: Language
  code: string
  stdin: string
  fixture?: string
}
interface ProviderResult {
  stdout?: string | null
  stderr?: string | null
  compile_output?: string | null
  status?: { id?: number; description?: string }
  token?: string
}

// Browser-only web and Mongo programs use the JS engine if remote judging is
// explicitly enabled. Java remains the only enabled language at launch.
const LANGUAGE_IDS: Record<Language, number> = { java: 62, python: 71, javascript: 63, typescript: 74, sql: 82, web: 63, mongo: 63 }
const errorResponse = (error: string, message: string, status: number) => Response.json({ error, message }, { status, headers: { 'Cache-Control': 'no-store' } })
const timeoutResult = () => ({ stdout: '', stderr: 'The judge exceeded its execution deadline.', compileOutput: '', exitCode: 1, timedOut: true, failureKind: 'timeout' as const })

function parseSubmission(value: unknown): Submission | null {
  if (!value || typeof value !== 'object') return null
  const body = value as Record<string, unknown>
  if (typeof body.language !== 'string' || !Object.hasOwn(LANGUAGE_IDS, body.language) || typeof body.code !== 'string' || typeof body.stdin !== 'string' || (body.fixture !== undefined && typeof body.fixture !== 'string')) return null
  return body as unknown as Submission
}

function normalizeResult(result: ProviderResult) {
  const id = result.status?.id
  const failureKind = id === 3 ? undefined : id === 5 ? 'timeout' : id === 6 ? 'compile-error' : 'runtime-error'
  return {
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : id === 3 || id === 6 ? '' : result.status?.description ?? 'Judge execution failed.',
    compileOutput: typeof result.compile_output === 'string' ? result.compile_output : '',
    exitCode: id === 3 ? 0 : 1,
    timedOut: id === 5,
    ...(failureKind ? { failureKind } : {}),
  }
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
}

async function providerFetch(url: string, init: RequestInit, signal: AbortSignal, timeoutMs = 20_000): Promise<{ ok: boolean; value: ProviderResult }> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal.aborted) abort()
  else signal.addEventListener('abort', abort, { once: true })
  let rejectAbort: () => void = () => {}
  const cancelled = new Promise<never>((_resolve, reject) => {
    rejectAbort = () => reject(new DOMException('Aborted', 'AbortError'))
    if (controller.signal.aborted) rejectAbort()
    else controller.signal.addEventListener('abort', rejectAbort, { once: true })
  })
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await Promise.race([cancelled, (async () => {
      const response = await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' })
      const raw: unknown = await response.json().catch(() => null)
      return { ok: response.ok, value: raw && typeof raw === 'object' ? raw as ProviderResult : {} }
    })()])
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
    controller.signal.removeEventListener('abort', rejectAbort)
  }
}

async function runJudge0(body: Submission, source: string, key: string, host: string, signal: AbortSignal) {
  const headers = { 'Content-Type': 'application/json', 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host }
  const base = `https://${host}/submissions`
  const init = { method: 'POST', headers, body: JSON.stringify({ language_id: LANGUAGE_IDS[body.language], source_code: source, stdin: body.stdin, cpu_time_limit: 10, wall_time_limit: 15 }) }
  const first = await providerFetch(`${base}?base64_encoded=false&wait=true`, init, signal)
  const status = first.value.status?.id
  if (first.ok && typeof status === 'number' && status !== 1 && status !== 2) return normalizeResult(first.value)

  // Providers that refuse synchronous waiting need a new asynchronous submission.
  const queued = first.ok && (status === 1 || status === 2) && first.value.token
    ? first
    : await providerFetch(`${base}?base64_encoded=false&wait=false`, init, signal)
  if (!queued.ok || typeof queued.value.token !== 'string' || !queued.value.token) throw new Error('Missing judge submission token')
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    await pause(Math.min(500, deadline - Date.now()), signal)
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    const polled = await providerFetch(`${base}/${encodeURIComponent(queued.value.token)}?base64_encoded=false`, { method: 'GET', headers }, signal, remaining)
    if (!polled.ok) throw new Error('Judge polling failed')
    const id = polled.value.status?.id
    if (typeof id === 'number' && id !== 1 && id !== 2) return normalizeResult(polled.value)
  }
  return timeoutResult()
}

export async function POST(req: Request) {
  const { user, profile } = await getUserAndProfile()
  if (!user || !profile) return errorResponse('not-signed-in', 'Sign in to use the Java judge.', 401)
  if (profile.account_status === 'banned') return errorResponse('banned', 'This account is banned.', 403)
  const body = parseSubmission(await req.json().catch(() => null))
  if (!body) return errorResponse('invalid-request', 'Expected language, code and stdin strings.', 400)
  const source = body.language === 'java' ? buildJavaSource(body.code, body.fixture) : body.code
  if (body.code.length + (body.fixture?.length ?? 0) + body.stdin.length > 64_000 || source.length + body.stdin.length > 64_000) return errorResponse('submission-too-large', 'Code and stdin must total at most 64,000 characters.', 413)
  if (body.language !== 'java' && process.env.JUDGE_ALL_LANGUAGES !== 'true') return errorResponse('judge-disabled', 'Remote judging is enabled only for Java.', 503)
  const key = process.env.JUDGE0_API_KEY?.trim()
  if (!key) return errorResponse('judge-not-configured', 'The Java judge is not configured on the server.', 503)
  if ((process.env.JUDGE_PROVIDER ?? 'judge0') !== 'judge0') return errorResponse('judge-provider-unavailable', 'The configured judge provider is not available.', 503)
  const host = process.env.JUDGE0_HOST?.trim() || 'judge0-ce.p.rapidapi.com'
  if (!/^[a-zA-Z0-9.-]+$/.test(host)) return errorResponse('judge-not-configured', 'The configured judge host is invalid.', 503)
  try {
    const rate = await checkRate(user.id, 'judge')
    if (!rate.ok) return errorResponse('rate-limited', rate.message, 429)
    return Response.json(await runJudge0(body, source, key, host, req.signal), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return Response.json(timeoutResult(), { headers: { 'Cache-Control': 'no-store' } })
    return errorResponse('judge-unavailable', 'The judge could not complete this submission. Please try again.', 502)
  }
}
