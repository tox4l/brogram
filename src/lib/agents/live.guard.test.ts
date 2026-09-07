// TI-1 (Wave 2 review, §4): `npx vitest run` is the wave-gate command every
// task and every wave gate depends on. src/lib/agents/live.test.ts must never
// make a billed, network-dependent DeepSeek call just because a machine has
// a `.env.local` with DEEPSEEK_API_KEY in it — the live suite requires an
// explicit opt-in (`RUN_LIVE_AGENT_TESTS=1 npx vitest run
// src/lib/agents/live.test.ts`), not the incidental presence of a key.
//
// This reads live.test.ts as source text rather than importing it, so this
// guard test itself can never trigger the very side effect it is checking
// for (a plain `import` would run the file's module-scope code, including
// whatever env-loading call is there).
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const LIVE_TEST_PATH = join(dirname(fileURLToPath(import.meta.url)), 'live.test.ts')
const SOURCE = readFileSync(LIVE_TEST_PATH, 'utf8')

describe('live.test.ts stays hermetic by default (TI-1)', () => {
  it('never calls loadDotEnvLocal() unconditionally at module scope', () => {
    // The regression this guards: a bare `loadDotEnvLocal()` call with no
    // guard populates DEEPSEEK_API_KEY from .env.local before
    // describe.skipIf below ever gets to read it, so the live suite runs on
    // any machine with a key configured.
    expect(SOURCE).not.toMatch(/^loadDotEnvLocal\(\)\s*$/m)
  })

  it('loads .env.local only behind an explicit RUN_LIVE_AGENT_TESTS opt-in', () => {
    expect(SOURCE).toMatch(/if\s*\(\s*process\.env\.RUN_LIVE_AGENT_TESTS\s*\)\s*loadDotEnvLocal\(\)/)
  })

  it('gates the live suite on both RUN_LIVE_AGENT_TESTS and DEEPSEEK_API_KEY', () => {
    expect(SOURCE).toMatch(
      /describe\.skipIf\(!process\.env\.RUN_LIVE_AGENT_TESTS \|\| !process\.env\.DEEPSEEK_API_KEY\)/,
    )
  })

  it('documents the opt-in command in its header and drops the now-false vitest.config.mts claim', () => {
    expect(SOURCE).toMatch(/RUN_LIVE_AGENT_TESTS=1 npx vitest run src\/lib\/agents\/live\.test\.ts/)
    expect(SOURCE).not.toMatch(/vitest\.config\.mts must never load \.env\.local/)
  })
})
