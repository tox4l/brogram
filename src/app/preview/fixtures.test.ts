// V1 (Critical, Wave 2 review §5): src/app/preview/fixtures.ts is imported by
// a 'use client' page (page.tsx), so any module it imports ships whole in a
// browser chunk. It used to `import ... from '../../../seed/exercises/*.json'`
// -- three raw seed exercise files -- and shipped 43 model answers plus 180
// hidden-test answers into an unauthenticated production chunk (verified
// directly in .next/static/chunks against the committed seed counts).
//
// This reads fixtures.ts as source text rather than importing it, so a
// regression (someone re-adding a seed/exercises/*.json import) is caught
// here before any bundler runs, and this guard test itself cannot be fooled
// by a runtime pick that only reads back a couple of safe fields (the whole
// imported module still ships regardless of which fields get read out of
// it). scripts/check-bundle-budget.mjs's scanForSecrets() is the build-level
// half of the same guarantee, run against the real emitted chunks after
// `npm run build`.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const FIXTURES_PATH = join(dirname(fileURLToPath(import.meta.url)), 'fixtures.ts')
const SOURCE = readFileSync(FIXTURES_PATH, 'utf8')

describe('src/app/preview/fixtures.ts never imports a secret-bearing seed file', () => {
  it('imports nothing from seed/exercises/ (the only seed files carrying a model answer and hidden-test answers)', () => {
    expect(SOURCE).not.toMatch(/from\s+['"][^'"]*seed\/exercises\//)
  })

  it('never carries a model-answer field in its own source', () => {
    // Split so this very assertion does not itself trip a repo-wide grep for
    // the word (e.g. scripts/check-bundle-budget.mjs's own scanner).
    expect(SOURCE).not.toMatch(new RegExp('reference' + 'Solution'))
  })

  it('never carries an expectedStdout literal', () => {
    expect(SOURCE).not.toMatch(/expectedStdout/)
  })
})
