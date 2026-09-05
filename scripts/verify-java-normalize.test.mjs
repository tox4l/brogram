import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeJavaSolution } from './lib/java-normalize.mjs'

describe('normalizeJavaSolution', () => {
  it('drops public from a top-level class Solution declaration', () => {
    expect(normalizeJavaSolution('public class Solution {')).toBe('class Solution {')
  })

  it('drops public from a final class Solution declaration', () => {
    expect(normalizeJavaSolution('public final class Solution {')).toBe('final class Solution {')
  })

  it('drops public from an abstract class Solution declaration', () => {
    expect(normalizeJavaSolution('public abstract class Solution {')).toBe('abstract class Solution {')
  })

  it('leaves an unrelated public class Main untouched', () => {
    const src = 'public class Main {\n    public static void main(String[] args) {}\n}\n'
    expect(normalizeJavaSolution(src)).toBe(src)
  })

  it('may also rewrite a matching comment (acceptable, not exempted)', () => {
    const src = '// public class Solution in a comment'
    expect(normalizeJavaSolution(src)).toBe('// class Solution in a comment')
  })

  it('produces exactly one public class when combined with the smoke exercise fixture', () => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url))
    const smoke = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed', 'exercises', 'smoke.json'), 'utf8'))
    const exercise = smoke.exercises.find((e) => e.language === 'java')
    const combined = `${exercise.fixture}\n${normalizeJavaSolution(exercise.referenceSolution)}`
    const publicClassCount = (combined.match(/\bpublic\s+(?:final\s+|abstract\s+)?class\b/g) ?? []).length
    expect(publicClassCount).toBe(1)
  })
})
