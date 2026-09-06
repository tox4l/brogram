import { afterEach, describe, expect, it, vi } from 'vitest'
import { getRuntime } from './index'
import { JsAdapter } from './js'
import { PyodideAdapter } from './pyodide'
import { SqlAdapter } from './sql'
import { MongoAdapter } from './mongo'
import { WebAdapter } from './web'
import { JudgeAdapter } from './judge'

describe('runtime routing', () => {
  it('selects all seven language paths without spawning workers on import', () => {
    for (const [language, Adapter] of [
      ['python', PyodideAdapter], ['javascript', JsAdapter], ['typescript', JsAdapter],
      ['sql', SqlAdapter], ['mongo', MongoAdapter], ['web', WebAdapter], ['java', JudgeAdapter],
    ] as const) {
      expect(getRuntime(language)).toBeInstanceOf(Adapter)
      expect(getRuntime(language).language).toBe(language)
      expect(getRuntime(language)).toBe(getRuntime(language))
    }
  })

  it('sends Java to the browser runtime only when the provider is "browser"', async () => {
    // getRuntime caches per module instance, so each provider value needs a
    // fresh graph - and the adapter classes must come from that same graph.
    const routeJava = async (provider: string) => {
      vi.stubEnv('NEXT_PUBLIC_JUDGE_PROVIDER', provider)
      vi.resetModules()
      const [runtimes, java] = await Promise.all([import('./index'), import('./java')])
      return { adapter: runtimes.getRuntime('java'), Java: java.JavaAdapter, absent: runtimes.judgeProviderAbsent() }
    }
    const browser = await routeJava('browser')
    expect(browser.adapter).toBeInstanceOf(browser.Java)
    expect(browser.absent).toBe(false)

    const none = await routeJava('none')
    expect(none.adapter).not.toBeInstanceOf(none.Java)
    expect(none.absent).toBe(true)
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})
