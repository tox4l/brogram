// Spec §11.3: "A test asserts that no generated file under public/curriculum/
// contains the string referenceSolution or expectedStdout." This is the
// black-box half of that guarantee — it shells out to the real CLI (the same
// command CI and `npm run build`'s prebuild run) and then inspects exactly
// what a browser would be served from public/curriculum/.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const PUBLIC_CURRICULUM_DIR = join(ROOT, 'public', 'curriculum')
const COURSE_DIR = join(PUBLIC_CURRICULUM_DIR, 'course')
const SEED_DIR = join(ROOT, 'seed')

function walkFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walkFiles(full, out)
    else out.push(full)
  }
  return out
}

function readSeedJson(relPath: string): unknown {
  return JSON.parse(readFileSync(join(SEED_DIR, relPath), 'utf8'), (key, value) => (key.startsWith('$') ? undefined : value))
}

beforeAll(() => {
  execFileSync(process.execPath, [join(ROOT, 'scripts', 'build-static-curriculum.mjs')], {
    cwd: ROOT,
    stdio: 'pipe',
  })
}, 60_000)

describe('public/curriculum never leaks a secret', () => {
  it('produced at least one course file', () => {
    expect(existsSync(COURSE_DIR)).toBe(true)
    expect(readdirSync(COURSE_DIR).length).toBeGreaterThan(0)
  })

  it('no file under public/curriculum/ contains "referenceSolution" or "expectedStdout"', () => {
    const files = walkFiles(PUBLIC_CURRICULUM_DIR)
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const content = readFileSync(file, 'utf8')
      expect(content.includes('referenceSolution'), `${file} contains "referenceSolution"`).toBe(false)
      expect(content.includes('expectedStdout'), `${file} contains "expectedStdout"`).toBe(false)
    }
  })

  it('no exercise object carries a reference/solution/answer-shaped key', () => {
    const suspicious = /reference|solution|answer/i
    for (const file of readdirSync(COURSE_DIR)) {
      const data = JSON.parse(readFileSync(join(COURSE_DIR, file), 'utf8')) as { exercises: Record<string, unknown>[] }
      for (const exercise of data.exercises) {
        for (const key of Object.keys(exercise)) {
          expect(suspicious.test(key), `${file}: exercise "${exercise.title}" carries key "${key}"`).toBe(false)
        }
      }
    }
  })

  it("each live course file's exercise count equals the verified seed exercise count for that course", () => {
    const { courses } = readSeedJson('courses.json') as { courses: { code: string; status: string }[] }
    const { clos } = readSeedJson('clos.json') as { clos: { id: string; course: string }[] }
    const courseByCloId = new Map(clos.map((c) => [c.id, c.course]))

    const exercisesDir = join(SEED_DIR, 'exercises')
    const expectedCounts = new Map<string, number>()
    for (const name of readdirSync(exercisesDir)) {
      const full = join(exercisesDir, name)
      // seed/exercises/unverified/ is a directory here, and never counted.
      if (!statSync(full).isFile() || !name.endsWith('.json')) continue
      const { exercises } = readSeedJson(join('exercises', name)) as { exercises: { cloId: string; verified?: boolean }[] }
      for (const exercise of exercises) {
        if (exercise.verified === false) continue
        const code = courseByCloId.get(exercise.cloId)
        if (!code) continue
        expectedCounts.set(code, (expectedCounts.get(code) ?? 0) + 1)
      }
    }

    const liveCourses = courses.filter((c) => c.status === 'live')
    expect(liveCourses.length).toBeGreaterThan(0)
    for (const c of liveCourses) {
      const data = JSON.parse(readFileSync(join(COURSE_DIR, `${c.code}.json`), 'utf8')) as { exercises: unknown[] }
      expect(data.exercises.length, `${c.code} exercise count`).toBe(expectedCounts.get(c.code) ?? 0)
    }
  })
})
