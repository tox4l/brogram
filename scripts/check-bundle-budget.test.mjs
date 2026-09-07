// V1 (Critical, Wave 2 review §5): unit-tests the pure scanner functions
// check-bundle-budget.mjs adds to guard against a secret (a model answer or
// a lesson's hidden stdout) reaching a shipped client chunk. Importing the
// script does not run its real build check -- see the `import.meta.url`
// guard at the bottom of the script -- so this test never needs a real
// `npm run build` or a `.next` directory.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SECRET_MARKERS, findChunkFiles, scanForSecrets } from './check-bundle-budget.mjs'

describe('SECRET_MARKERS', () => {
  it('is exactly the two markers the review named', () => {
    expect(SECRET_MARKERS).toEqual(['referenceSolution', 'expectedStdout'])
  })
})

describe('scanForSecrets (fixture strings, no filesystem)', () => {
  it('reports no hits for a chunk with neither marker', () => {
    const files = ['chunk-a.js']
    const content = { 'chunk-a.js': 'const x=1;function y(){return x+1}' }
    expect(scanForSecrets(files, (f) => content[f])).toEqual([])
  })

  it('catches a minified referenceSolution field', () => {
    const files = ['chunk-a.js']
    const content = { 'chunk-a.js': '{cloId:"INFS1101-1",referenceSolution:"def f():\\n  pass"}' }
    expect(scanForSecrets(files, (f) => content[f])).toEqual([{ file: 'chunk-a.js', marker: 'referenceSolution' }])
  })

  it('catches a minified expectedStdout field, independently of referenceSolution', () => {
    const files = ['chunk-b.js']
    const content = { 'chunk-b.js': '{type:"snippet",expectedStdout:"2\\n1"}' }
    expect(scanForSecrets(files, (f) => content[f])).toEqual([{ file: 'chunk-b.js', marker: 'expectedStdout' }])
  })

  it('reports both markers when a chunk carries both, and only flags the files that actually match across several chunks', () => {
    const files = ['clean.js', 'both.js', 'clean2.js']
    const content = {
      'clean.js': 'export const noop = () => {}',
      'both.js': 'referenceSolution:"x";expectedStdout:"y"',
      'clean2.js': 'const z = 3',
    }
    expect(scanForSecrets(files, (f) => content[f])).toEqual([
      { file: 'both.js', marker: 'referenceSolution' },
      { file: 'both.js', marker: 'expectedStdout' },
    ])
  })

  it('also catches a quoted-key form (a JSON-shaped literal inlined into JS)', () => {
    const files = ['chunk-d.js']
    const content = { 'chunk-d.js': '{"referenceSolution":"def f(): pass"}' }
    expect(scanForSecrets(files, (f) => content[f])).toEqual([{ file: 'chunk-d.js', marker: 'referenceSolution' }])
  })

  it('catches the double-quoted, backslash-escaped shape webpack/minifiers emit for an inlined JSON string literal (F6, review round 2)', () => {
    const files = ['chunk-e.js']
    const content = { 'chunk-e.js': 'JSON.parse("{\\"referenceSolution\\":\\"def f(): pass\\"}")' }
    expect(scanForSecrets(files, (f) => content[f])).toEqual([{ file: 'chunk-e.js', marker: 'referenceSolution' }])
  })

  // The two false-positive shapes below are not hypothetical: a real
  // `npm run build` of this tree emits exactly these two, reviewed as
  // identifier-only and non-secret (see the comment above markerPattern).
  it('does not flag a destructuring strip that discards the field (no secret value ships)', () => {
    const files = ['exercise-page-chunk.js']
    const content = { 'exercise-page-chunk.js': 'let{referenceSolution:f,...x}=u,g={...x,id:u.id,origin:"generated"}' }
    expect(scanForSecrets(files, (f) => content[f])).toEqual([])
  })

  it('does not flag a bare property access (the dev-only /preview/java-verify harness reads this off a runtime-injected object, never bundled data)', () => {
    const files = ['java-verify-chunk.js']
    const content = { 'java-verify-chunk.js': 'await o.run(n(s,s.referenceSolution))' }
    expect(scanForSecrets(files, (f) => content[f])).toEqual([])
  })
})

describe('findChunkFiles (real filesystem, real temp directory)', () => {
  let dir
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  it('walks nested directories and returns only .js files', () => {
    dir = mkdtempSync(join(tmpdir(), 'chunk-scan-'))
    writeFileSync(join(dir, 'a.js'), 'const a = 1')
    writeFileSync(join(dir, 'a.js.map'), '{}')
    const nested = join(dir, 'nested')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, 'b.js'), 'const b = 2')

    const found = findChunkFiles(dir).map((f) => f.replace(dir, '').split('\\').join('/')).sort()
    expect(found).toEqual(['/a.js', '/nested/b.js'])
  })

  it('returns an empty array for a directory that does not exist', () => {
    expect(findChunkFiles(join(tmpdir(), 'chunk-scan-does-not-exist-xyz'))).toEqual([])
  })
})
