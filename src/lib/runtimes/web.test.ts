import { afterEach, describe, expect, it, vi } from 'vitest'
// jsdom ships JavaScript only; the installed dependency set has no @types/jsdom.
// @ts-expect-error No declaration file in the fixed launch dependency set.
import { JSDOM, VirtualConsole } from 'jsdom'
import smoke from '../../../seed/exercises/smoke.json'
import type { RunRequest } from '../contracts'
import { WebAdapter } from './web'

type Message = { type: string; nonce: string; [key: string]: unknown }
type TestFrame = {
  element: HTMLIFrameElement
  requests: Message[]
  replies: Message[]
  close(): void
}

const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

// jsdom does not load iframe.srcdoc. Shim only that browser transport boundary:
// the production srcdoc, scripts, DOM, assertions and adapter remain real.
function installFrames(options: { stallRun?: boolean; stallReady?: boolean } = {}) {
  const frames: TestFrame[] = []
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLIFrameElement)) continue
        const source = node.contentWindow!
        const entry: TestFrame = { element: node, requests: [], replies: [], close() {} }
        frames.push(entry)
        const parentBoundary = {
          postMessage(data: Message) {
            entry.replies.push(data)
            if (options.stallReady && data.type === 'ready') return
            queueMicrotask(() => window.dispatchEvent(new MessageEvent('message', { data, source })))
          },
        }
        const dom = new JSDOM(node.srcdoc, {
          runScripts: 'dangerously',
          virtualConsole: new VirtualConsole(),
          beforeParse(frameWindow: Window) {
            Object.defineProperty(frameWindow, 'parent', { value: parentBoundary })
          },
        })
        entry.close = () => dom.window.close()
        vi.spyOn(source, 'postMessage').mockImplementation((data: Message) => {
          entry.requests.push(data)
          if (options.stallRun) return
          queueMicrotask(() => dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
            data,
            source: parentBoundary,
          })))
        })
      }
      for (const node of record.removedNodes) {
        frames.find((frame) => frame.element === node)?.close()
      }
    }
  })
  observer.observe(document.body, { childList: true })
  cleanups.push(() => {
    observer.disconnect()
    frames.forEach((frame) => frame.close())
  })
  return { frames, options }
}

function request(overrides: Partial<RunRequest> = {}): RunRequest {
  return {
    language: 'web',
    code: '<script>document.body.dataset.answer = "ok"</script>',
    tests: [{ id: 'one', input: 'return document.body.dataset.answer', expected: 'ok', hidden: false }],
    timeoutMs: 5_000,
    ...overrides,
  }
}

describe('WebAdapter', () => {
  it('grades every counter smoke test with a fresh DOM and the reference solution', async () => {
    const { frames } = installFrames()
    const adapter = new WebAdapter()
    const exercise = smoke.exercises.find((exercise) => exercise.language === 'web')!
    const result = await adapter.run(request({
      code: exercise.referenceSolution,
      fixture: exercise.fixture,
      tests: exercise.tests,
    }))
    expect(result).toMatchObject({ ok: true, passedCount: 5, totalCount: 5, runtime: 'browser' })
    expect(result.results.map((test) => test.actual)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok'])
    expect(frames.every((frame) => frame.element.getAttribute('sandbox') === 'allow-scripts')).toBe(true)
    adapter.abort()
  })

  it('captures console output and errors on free runs', async () => {
    installFrames()
    const adapter = new WebAdapter()
    const result = await adapter.run(request({
      tests: [], code: '<script>console.log("answer", 42); console.error("check");</script>',
    }))
    expect(result).toMatchObject({ ok: true, totalCount: 0, results: [], stdout: 'answer 42\n', stderr: 'check\n' })
    const failure = await adapter.run(request({ tests: [], code: '<script>throw new Error("broken student script")</script>' }))
    expect(failure.ok).toBe(false)
    expect(failure.stderr).toContain('broken student script')
    adapter.abort()
  })

  it('reports assertion exceptions and wrong answers separately', async () => {
    installFrames()
    const adapter = new WebAdapter()
    const result = await adapter.run(request({ tests: [
      { id: 'wrong', input: 'return "no"', expected: 'ok', hidden: false },
      { id: 'broken', input: 'throw new Error("broken assertion")', expected: 'ok', hidden: true },
    ] }))
    expect(result.results[0]).toMatchObject({ actual: 'no', passed: false, failureKind: 'wrong-answer' })
    expect(result.results[1]).toMatchObject({ passed: false, failureKind: 'runtime-error' })
    expect(result.results[1].stderr).toContain('broken assertion')
    adapter.abort()
  })

  it('embeds closing-script strings safely and does not interpolate assertions as HTML', async () => {
    installFrames()
    const adapter = new WebAdapter()
    const result = await adapter.run(request({ tests: [{
      id: 'literal', input: 'return "</script><script>throw new Error(\\"injected\\")</script>"',
      expected: '</script><script>throw new Error("injected")</script>', hidden: false,
    }] }))
    expect(result.ok).toBe(true)
    adapter.abort()
  })

  it('ignores forged message sources and nonces before accepting the real frame result', async () => {
    const { frames } = installFrames({ stallRun: true })
    const adapter = new WebAdapter()
    let settled = false
    const pending = adapter.run(request()).then((result) => { settled = true; return result })
    await vi.waitFor(() => expect(frames[0]?.requests.length).toBe(1))
    const nonce = frames[0].requests[0].nonce
    const data = { type: 'result', nonce, actual: 'ok', stdout: '', stderr: '' }
    window.dispatchEvent(new MessageEvent('message', { data, source: window }))
    window.dispatchEvent(new MessageEvent('message', {
      data: { ...data, nonce: 'forged' }, source: frames[0].element.contentWindow,
    }))
    await Promise.resolve()
    expect(settled).toBe(false)
    window.dispatchEvent(new MessageEvent('message', { data, source: frames[0].element.contentWindow }))
    expect((await pending).ok).toBe(true)
    adapter.abort()
  })

  it('removes a stalled frame at five seconds, marks remaining tests timeout and promotes its standby', async () => {
    const { frames, options } = installFrames({ stallRun: true })
    const adapter = new WebAdapter()
    await adapter.warmup()
    const active = frames[0].element
    const standby = frames[1].element
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const pending = adapter.run(request({
      timeoutMs: 60_000,
      tests: [
        { id: 'one', input: 'return "ok"', expected: 'ok', hidden: false },
        { id: 'two', input: 'return "ok"', expected: 'ok', hidden: true },
      ],
    }))
    await vi.advanceTimersByTimeAsync(5_000)
    const result = await pending
    expect(result.results.map((test) => test.failureKind)).toEqual(['timeout', 'timeout'])
    expect(active.isConnected).toBe(false)
    expect(standby.isConnected).toBe(true)
    options.stallRun = false
    vi.useRealTimers()
    const next = await adapter.run(request())
    expect(next.ok).toBe(true)
    expect(frames[1].requests).toHaveLength(1)
    adapter.abort()
  })

  it('abort resolves a pending run even while the initial frame is loading', async () => {
    installFrames({ stallReady: true })
    const adapter = new WebAdapter()
    const pending = adapter.run(request())
    adapter.abort()
    expect((await pending).results[0].failureKind).toBe('timeout')
    adapter.abort()
  })

  it('abort is a no-op when nothing is pending, matching WorkerAdapter.abort()', async () => {
    const { frames } = installFrames()
    const adapter = new WebAdapter()
    await adapter.warmup()
    const active = frames[0].element
    const standby = frames[1].element
    adapter.abort()
    expect(active.isConnected).toBe(true)
    expect(standby.isConnected).toBe(true)
    const result = await adapter.run(request())
    expect(result.ok).toBe(true)
    adapter.abort()
  })

  it('recovers after a frame fails at startup, so the failure does not poison later warmups', async () => {
    const { options } = installFrames({ stallReady: true })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const adapter = new WebAdapter()
    // Attach the rejection handler before advancing timers so Node never sees an
    // unhandled rejection window between the reject and this test's own assertion.
    const failure = adapter.warmup().then(() => null, (e: unknown) => e)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(await failure).toMatchObject({ message: 'The web sandbox could not start.' })
    vi.useRealTimers()
    options.stallReady = false
    await adapter.warmup()
    const result = await adapter.run(request())
    expect(result.ok).toBe(true)
    adapter.abort()
  })
})
