import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// W4FIX-B2: the bundle lane's review found `src/app/providers.tsx` -- the
// root client boundary every single route mounts, `/` and `/login`
// included -- pulling in `QueryProvider` (TanStack Query) and the sound
// manager's `initSoundOnFirstGesture`, neither of which an unauthenticated
// route has any use for (no `useQuery` and no `play()` call site outside
// `(app)/**` or the buddy drawer, which only ever renders inside `(app)`).
// Both now mount from `src/app/(app)/providers.tsx` instead. This is the
// regression guard: a source scan, in the same shape as the gsap guard
// (`eases.test.ts`, W4FIX-B) and the buddy zod guard
// (`no-zod-in-client.test.ts`, W4FIX-B2) -- nothing else in the suite would
// fail if either import quietly came back, since `providers.tsx` has no
// dedicated render test of its own.
//
// Fix round (W4FIX-B2 re-check, M1): the first version of this guard read
// only `providers.tsx` and matched only the `@/`-aliased specifier. Ruling 5
// says "the root layout", not "this one file" -- mounting `<QueryProvider>`
// directly in `src/app/layout.tsx` (also this lane's own path), or
// importing it via a relative specifier from either file, put the weight
// back on `/` and `/login` with the guard still green. Both files are now
// scanned, and both the aliased and the relative specifier are checked.
describe("the root layout's providers mount nothing that only an authenticated route needs (W4FIX-B2)", () => {
  const ROOT = path.resolve(__dirname, '..', '..')
  const LAYOUT_SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'app', 'layout.tsx'), 'utf8')
  const PROVIDERS_SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'app', 'providers.tsx'), 'utf8')
  const COMBINED_SOURCE = `${LAYOUT_SOURCE}\n${PROVIDERS_SOURCE}`

  // Never crosses a quote, backtick or semicolon (see the identical guard
  // in `src/components/buddy/no-zod-in-client.test.ts` for why a bare
  // `[\s\S]*?` is unsafe: it can read straight through a real import's own
  // closing quote into a later comment that merely mentions a specifier).
  const STATIC_IMPORT_FROM = (specifier: RegExp) =>
    new RegExp(`^\\s*import\\s(?:[^'"\`;]*?from\\s*)?['"](${specifier.source})['"]`, 'm')

  // Matches either the `@/`-aliased specifier or the relative equivalent
  // reaching the same module under `src/components/shell/`.
  const aliasOrRelative = (moduleName: string) =>
    new RegExp(`(?:@\\/components\\/shell\\/${moduleName}|(?:\\.\\.?\\/)+components\\/shell\\/${moduleName})`)

  it('does not import the QueryProvider (TanStack Query only ever pays off under (app)), aliased or relative, from either file', () => {
    expect(STATIC_IMPORT_FROM(aliasOrRelative('QueryProvider')).test(COMBINED_SOURCE)).toBe(false)
  })

  it('does not import the sound manager (every play() call site lives under (app) or the buddy drawer), from either file', () => {
    expect(STATIC_IMPORT_FROM(/(?:@\/lib\/sound\/manager|(?:\.\.?\/)+lib\/sound\/manager)/).test(COMBINED_SOURCE)).toBe(false)
  })

  it('mounts the OS-only MotionAttributeStatic, not the prefs-aware, Supabase-reading MotionAttribute, from either file', () => {
    expect(
      STATIC_IMPORT_FROM(/(?:@\/components\/motion\/MotionAttributeStatic|(?:\.\.?\/)+components\/motion\/MotionAttributeStatic)/).test(
        COMBINED_SOURCE,
      ),
    ).toBe(true)
    // The plain (prefs-aware) MotionAttribute specifier, not the Static
    // one above -- checked against providers.tsx alone, since layout.tsx's
    // own import of `./providers` would otherwise share the substring
    // "MotionAttribute" via "MotionAttributeStatic" and produce a
    // meaningless result either way; PROVIDERS_SOURCE is the only file that
    // could plausibly import either component directly.
    expect(
      STATIC_IMPORT_FROM(/(?:@\/components\/motion\/MotionAttribute(?!Static)|(?:\.\.?\/)+components\/motion\/MotionAttribute(?!Static))/).test(
        PROVIDERS_SOURCE,
      ),
    ).toBe(false)
  })
})
