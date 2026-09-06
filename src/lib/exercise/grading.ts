import type { ExercisePublic, RunRequest, RunResult, TestResult } from '@/lib/contracts'

export function exerciseRunRequest(exercise: ExercisePublic, code: string, graded: boolean, packages: string[] = []): RunRequest {
  return { language: exercise.kind === 'schema' ? 'sql' : exercise.language, code, tests: graded ? exercise.tests : [], fixture: exercise.fixture, timeoutMs: 5000, packages }
}

export function usesAnswerForm(exercise: ExercisePublic): boolean {
  return exercise.kind === 'predict-output' || exercise.kind === 'spot-the-bug' || exercise.kind === 'trace'
}

/** Answers are kept as text in Attempt.code, including JSON for structured forms. */
export function gradeAnswer(exercise: ExercisePublic, answer: string): RunResult {
  const results: TestResult[] = exercise.tests.map(test => {
    let passed = false
    try {
      if (exercise.kind === 'predict-output') {
        const normalize = (text: string) => text.trim().replace(/\s+/g, ' ')
        passed = normalize(answer) === normalize(test.expected)
      } else if (exercise.kind === 'spot-the-bug') {
        const expected: unknown = JSON.parse(test.expected)
        const actual: unknown = JSON.parse(answer)
        const valid = (value: unknown): value is number[] => Array.isArray(value) && value.every(line => Number.isInteger(line) && line > 0)
        if (valid(expected) && valid(actual)) {
          const expectedSet = new Set(expected); const actualSet = new Set(actual)
          passed = expectedSet.size === actualSet.size && [...expectedSet].every(line => actualSet.has(line))
        }
      } else if (exercise.kind === 'trace') {
        const expected: unknown = JSON.parse(test.expected); const actual: unknown = JSON.parse(answer)
        if (expected && actual && typeof expected === 'object' && typeof actual === 'object' && !Array.isArray(expected) && !Array.isArray(actual)) {
          const wanted = expected as Record<string, unknown>; const cells = actual as Record<string, unknown>
          passed = Object.keys(wanted).length === Object.keys(cells).length && Object.entries(wanted).every(([key, value]) => Object.hasOwn(cells, key) && String(cells[key]) === String(value))
        }
      }
    } catch { /* An incomplete answer is a wrong answer, not a broken screen. */ }
    return { testId: test.id, passed, actual: answer, expected: test.expected, stdout: '', stderr: '', durationMs: 0, ...(passed ? {} : { failureKind: 'wrong-answer' as const }) }
  })
  const passedCount = results.filter(result => result.passed).length
  return { ok: results.length > 0 && passedCount === results.length, results, passedCount, totalCount: results.length, runtime: 'browser' }
}

/** A single valid unified hunk is enough for the Coach; trim to the request budget. */
export function codeDiff(before: string, after: string): string {
  if (before === after) return ''
  const oldLines = before.split('\n'); const newLines = after.split('\n')
  let start = 0
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start++
  let oldEnd = oldLines.length; let newEnd = newLines.length
  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) { oldEnd--; newEnd-- }
  return [`--- previous`, `+++ current`, `@@ -${start + 1},${oldEnd - start} +${start + 1},${newEnd - start} @@`, ...oldLines.slice(start, oldEnd).map(line => `-${line}`), ...newLines.slice(start, newEnd).map(line => `+${line}`)].join('\n').slice(0, 8000)
}
