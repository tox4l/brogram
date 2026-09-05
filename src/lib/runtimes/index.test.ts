import { describe, expect, it } from 'vitest'
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
})
