import { describe, it, expect } from 'vitest'
import type { LessonProgress, LessonPublic } from '@/lib/contracts'
import { lessonStatus, isStale, nextProgress } from './progress'

const lesson = (version: number): LessonPublic => ({
  id: 'INFS1101-3', cloId: 'INFS1101-3', course: 'INFS1101', language: 'python',
  version, title: 't', hook: 'h', estimatedMinutes: 5, draft: false, tags: [],
  blocks: [], exitLine: 'x',
})

const progress = (overrides: Partial<LessonProgress> = {}): LessonProgress => ({
  userId: 'u1', lessonId: 'INFS1101-3', cloId: 'INFS1101-3', status: 'started',
  blockIndex: 2, checksPassed: 1, checksFailed: 1, lessonVersion: 1,
  startedAt: '2026-09-01T00:00:00.000Z', completedAt: null, updatedAt: '2026-09-01T00:00:00.000Z',
  ...overrides,
})

describe('lessonStatus', () => {
  it('is unseen for null progress', () => {
    expect(lessonStatus(null)).toBe('unseen')
  })

  it('passes through the stored status otherwise', () => {
    expect(lessonStatus(progress({ status: 'started' }))).toBe('started')
    expect(lessonStatus(progress({ status: 'completed' }))).toBe('completed')
    expect(lessonStatus(progress({ status: 'skipped' }))).toBe('skipped')
  })
})

describe('isStale', () => {
  it('is true only when the stored version is lower than the lesson version', () => {
    expect(isStale(progress({ lessonVersion: 1 }), lesson(2))).toBe(true)
  })

  it('is false when equal or the stored version is ahead', () => {
    expect(isStale(progress({ lessonVersion: 2 }), lesson(2))).toBe(false)
    expect(isStale(progress({ lessonVersion: 3 }), lesson(2))).toBe(false)
  })
})

describe('nextProgress: opened', () => {
  it('creates a fresh started progress when there is none, carrying the userId from the event', () => {
    const p = nextProgress(null, { type: 'opened', lesson: lesson(2), userId: 'u1' }, '2026-09-06T00:00:00.000Z')
    expect(p).toMatchObject({
      userId: 'u1', lessonId: 'INFS1101-3', cloId: 'INFS1101-3', status: 'started',
      blockIndex: 0, checksPassed: 0, checksFailed: 0, lessonVersion: 2,
      startedAt: '2026-09-06T00:00:00.000Z', completedAt: null, updatedAt: '2026-09-06T00:00:00.000Z',
    })
  })

  it('preserves status, completedAt and check counters when the stored progress is stale (progress is never deleted); only blockIndex resets and lessonVersion bumps', () => {
    const prev = progress({ lessonVersion: 1, status: 'completed', blockIndex: 6, checksPassed: 3, checksFailed: 2, completedAt: '2026-09-01T00:00:00.000Z' })
    const p = nextProgress(prev, { type: 'opened', lesson: lesson(2), userId: 'u1' }, '2026-09-06T00:00:00.000Z')
    expect(p).toMatchObject({
      status: 'completed', blockIndex: 0, checksPassed: 3, checksFailed: 2,
      lessonVersion: 2, completedAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-06T00:00:00.000Z',
    })
  })

  it('also preserves a non-completed status (started/skipped) across a stale reopen', () => {
    const prev = progress({ lessonVersion: 1, status: 'skipped', blockIndex: 3, checksPassed: 1, checksFailed: 4 })
    const p = nextProgress(prev, { type: 'opened', lesson: lesson(2), userId: 'u1' }, '2026-09-06T00:00:00.000Z')
    expect(p).toMatchObject({ status: 'skipped', blockIndex: 0, checksPassed: 1, checksFailed: 4, lessonVersion: 2 })
  })

  it('never regresses a completed lesson back to started when reopened at the same version', () => {
    const prev = progress({ status: 'completed', lessonVersion: 2, completedAt: '2026-09-01T00:00:00.000Z' })
    const p = nextProgress(prev, { type: 'opened', lesson: lesson(2), userId: 'u1' }, '2026-09-06T00:00:00.000Z')
    expect(p.status).toBe('completed')
    expect(p.completedAt).toBe('2026-09-01T00:00:00.000Z')
    expect(p.updatedAt).toBe('2026-09-06T00:00:00.000Z')
  })

  it('moves a skipped lesson back to started when reopened at the same version', () => {
    const prev = progress({ status: 'skipped', lessonVersion: 2 })
    const p = nextProgress(prev, { type: 'opened', lesson: lesson(2), userId: 'u1' }, '2026-09-06T00:00:00.000Z')
    expect(p.status).toBe('started')
  })
})

describe('nextProgress: block-advanced', () => {
  it('updates the block index and updatedAt', () => {
    const prev = progress({ blockIndex: 1 })
    const p = nextProgress(prev, { type: 'block-advanced', index: 4 }, '2026-09-06T00:00:00.000Z')
    expect(p.blockIndex).toBe(4)
    expect(p.updatedAt).toBe('2026-09-06T00:00:00.000Z')
  })

  it('throws if the lesson was never opened', () => {
    expect(() => nextProgress(null, { type: 'block-advanced', index: 1 }, '2026-09-06T00:00:00.000Z')).toThrow()
  })
})

describe('nextProgress: check', () => {
  it('increments checksPassed on a right answer', () => {
    const prev = progress({ checksPassed: 1, checksFailed: 1 })
    const p = nextProgress(prev, { type: 'check', right: true }, '2026-09-06T00:00:00.000Z')
    expect(p.checksPassed).toBe(2)
    expect(p.checksFailed).toBe(1)
  })

  it('increments checksFailed on a wrong answer, and never touches anything else on the record', () => {
    const prev = progress({ checksPassed: 1, checksFailed: 1, status: 'started' })
    const p = nextProgress(prev, { type: 'check', right: false }, '2026-09-06T00:00:00.000Z')
    expect(p.checksPassed).toBe(1)
    expect(p.checksFailed).toBe(2)
    expect(p.status).toBe('started')
  })
})

describe('nextProgress: completed', () => {
  it('sets status and completedAt', () => {
    const prev = progress({ status: 'started', completedAt: null })
    const p = nextProgress(prev, { type: 'completed' }, '2026-09-06T00:00:00.000Z')
    expect(p.status).toBe('completed')
    expect(p.completedAt).toBe('2026-09-06T00:00:00.000Z')
  })

  it('keeps the first completedAt on a repeat completion (idempotent; no re-minted daily-goal win)', () => {
    const firstCompletion = nextProgress(progress({ status: 'started', completedAt: null }), { type: 'completed' }, '2026-09-01T00:00:00.000Z')
    const secondCompletion = nextProgress(firstCompletion, { type: 'completed' }, '2026-09-06T00:00:00.000Z')
    expect(secondCompletion.completedAt).toBe('2026-09-01T00:00:00.000Z')
    expect(secondCompletion.updatedAt).toBe('2026-09-06T00:00:00.000Z')
    expect(secondCompletion.status).toBe('completed')
  })
})

describe('nextProgress: skipped', () => {
  it('sets status to skipped from started', () => {
    const prev = progress({ status: 'started' })
    const p = nextProgress(prev, { type: 'skipped' }, '2026-09-06T00:00:00.000Z')
    expect(p.status).toBe('skipped')
  })

  it('never regresses a completed lesson to skipped', () => {
    const prev = progress({ status: 'completed', completedAt: '2026-09-01T00:00:00.000Z' })
    const p = nextProgress(prev, { type: 'skipped' }, '2026-09-06T00:00:00.000Z')
    expect(p.status).toBe('completed')
  })

  it('throws if the lesson was never opened', () => {
    expect(() => nextProgress(null, { type: 'skipped' }, '2026-09-06T00:00:00.000Z')).toThrow()
  })
})
