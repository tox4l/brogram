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
describe("the root layout's providers mount nothing that only an authenticated route needs (W4FIX-B2)", () => {
  const ROOT = path.resolve(__dirname, '..', '..')
  const SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'app', 'providers.tsx'), 'utf8')

  // Never crosses a quote, backtick or semicolon (see the identical guard
  // in `src/components/buddy/no-zod-in-client.test.ts` for why a bare
  // `[\s\S]*?` is unsafe: it can read straight through a real import's own
  // closing quote into a later comment that merely mentions a specifier).
  const STATIC_IMPORT_FROM = (specifier: RegExp) =>
    new RegExp(`^\\s*import\\s(?:[^'"\`;]*?from\\s*)?['"](${specifier.source})['"]`, 'm')

  it('does not import the QueryProvider (TanStack Query only ever pays off under (app))', () => {
    expect(STATIC_IMPORT_FROM(/@\/components\/shell\/QueryProvider/).test(SOURCE)).toBe(false)
  })

  it('does not import the sound manager (every play() call site lives under (app) or the buddy drawer)', () => {
    expect(STATIC_IMPORT_FROM(/@\/lib\/sound\/manager/).test(SOURCE)).toBe(false)
  })

  it('mounts the OS-only MotionAttributeStatic, not the prefs-aware, Supabase-reading MotionAttribute', () => {
    expect(STATIC_IMPORT_FROM(/@\/components\/motion\/MotionAttributeStatic/).test(SOURCE)).toBe(true)
    expect(STATIC_IMPORT_FROM(/@\/components\/motion\/MotionAttribute/).test(SOURCE)).toBe(false)
  })
})
