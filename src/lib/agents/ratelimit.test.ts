// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const stub = vi.hoisted(() => {
  const state = { hintCount: 0, usageCount: 0 }
  const client = {
    from(table: string) {
      const result = table === 'attempts' ? { data: [{ hint_count: state.hintCount }] } : { count: state.usageCount }
      const chain: unknown = new Proxy(
        {},
        {
          get: (_target, prop) => {
            if (prop === 'then') {
              return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
                Promise.resolve(result).then(resolve, reject)
            }
            return () => chain
          },
        },
      )
      return chain
    },
  }
  return { state, client }
})

vi.mock('@/lib/supabase/server', () => ({ serviceClient: () => stub.client }))

const load = () => import('./ratelimit')

beforeEach(() => {
  vi.resetModules()
  stub.state.hintCount = 0
  stub.state.usageCount = 0
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-05T12:00:00.000Z'))
})
afterEach(() => vi.useRealTimers())

describe('checkRate', () => {
  it('lets the coach through once a minute', async () => {
    const { checkRate } = await load()
    expect((await checkRate('u1', 'coach', 'hint-requested', 'ex_1')).ok).toBe(true)
    const second = await checkRate('u1', 'coach', 'hint-requested', 'ex_1')
    expect(second.ok).toBe(false)
    expect(second.message).toMatch(/60 seconds/)
    vi.advanceTimersByTime(60_001)
    expect((await checkRate('u1', 'coach', 'hint-requested', 'ex_1')).ok).toBe(true)
  })

  it('reopens the coach window when the student fails another attempt', async () => {
    const { checkRate } = await load()
    await checkRate('u1', 'coach', 'hint-requested', 'ex_1')
    expect((await checkRate('u1', 'coach', 'hint-requested', 'ex_1')).ok).toBe(false)
    await checkRate('u1', 'diagnoser', 'attempt-failed', 'ex_1')
    expect((await checkRate('u1', 'coach', 'hint-requested', 'ex_1')).ok).toBe(true)
  })

  it('counts the hints already spent on this exercise from the attempts table', async () => {
    const { checkRate } = await load()
    stub.state.hintCount = 5
    const decision = await checkRate('u1', 'coach', 'hint-requested', 'ex_1')
    expect(decision.ok).toBe(false)
    expect(decision.message).toMatch(/5 hints/)
  })

  it('keeps separate buckets per user and per agent', async () => {
    const { checkRate } = await load()
    await checkRate('u1', 'coach', 'hint-requested', 'ex_1')
    expect((await checkRate('u2', 'coach', 'hint-requested', 'ex_1')).ok).toBe(true)
    expect((await checkRate('u1', 'buddy', 'buddy-message')).ok).toBe(true)
  })

  it('allows twenty buddy messages an hour', async () => {
    const { checkRate } = await load()
    for (let i = 0; i < 20; i++) expect((await checkRate('u1', 'buddy', 'buddy-message')).ok).toBe(true)
    expect((await checkRate('u1', 'buddy', 'buddy-message')).ok).toBe(false)
    vi.advanceTimersByTime(3_600_001)
    expect((await checkRate('u1', 'buddy', 'buddy-message')).ok).toBe(true)
  })

  it('allows ten author generations an hour', async () => {
    const { checkRate } = await load()
    for (let i = 0; i < 10; i++) expect((await checkRate('u1', 'author', 'bank-miss')).ok).toBe(true)
    expect((await checkRate('u1', 'author', 'bank-miss')).ok).toBe(false)
  })

  it('allows sixty calls an hour for every other agent', async () => {
    const { checkRate } = await load()
    for (let i = 0; i < 60; i++) expect((await checkRate('u1', 'reviewer', 'attempt-passed')).ok).toBe(true)
    expect((await checkRate('u1', 'reviewer', 'attempt-passed')).ok).toBe(false)
  })

  it('allows thirty judge runs an hour', async () => {
    const { checkRate } = await load()
    for (let i = 0; i < 30; i++) expect((await checkRate('u1', 'judge')).ok).toBe(true)
    expect((await checkRate('u1', 'judge')).ok).toBe(false)
  })

  it('backstops an empty bucket with the recorded usage of the last hour', async () => {
    const { checkRate } = await load()
    stub.state.usageCount = 20
    const decision = await checkRate('u1', 'buddy', 'buddy-message')
    expect(decision.ok).toBe(false)
    expect(decision.message).toMatch(/hour/)
  })

  it('reserves capacity before the database checks, so a burst cannot overshoot', async () => {
    const { checkRate } = await load()
    const decisions = await Promise.all(Array.from({ length: 25 }, () => checkRate('u1', 'author', 'bank-miss')))
    expect(decisions.filter(d => d.ok)).toHaveLength(10)
  })

  it('gives the reservation back when the backstop refuses', async () => {
    const { checkRate } = await load()
    stub.state.usageCount = 20
    expect((await checkRate('u1', 'buddy', 'buddy-message')).ok).toBe(false)
    stub.state.usageCount = 0
    for (let i = 0; i < 20; i++) expect((await checkRate('u1', 'buddy', 'buddy-message')).ok).toBe(true)
  })

  it('counts the hints it hands out, so a slow student cannot pass the per-exercise cap', async () => {
    const { checkRate } = await load()
    for (let i = 0; i < 5; i++) {
      expect((await checkRate('u1', 'coach', 'hint-requested', 'ex_1')).ok, `hint ${i + 1}`).toBe(true)
      vi.advanceTimersByTime(61_000)
    }
    const sixth = await checkRate('u1', 'coach', 'hint-requested', 'ex_1')
    expect(sixth.ok).toBe(false)
    expect(sixth.message).toMatch(/5 hints/)
  })

  it('counts hints per exercise and clears them when that exercise fails again', async () => {
    const { checkRate } = await load()
    for (let i = 0; i < 5; i++) {
      await checkRate('u1', 'coach', 'hint-requested', 'ex_1')
      vi.advanceTimersByTime(61_000)
    }
    expect((await checkRate('u1', 'coach', 'hint-requested', 'ex_2')).ok).toBe(true)
    await checkRate('u1', 'diagnoser', 'attempt-failed', 'ex_1')
    expect((await checkRate('u1', 'coach', 'hint-requested', 'ex_1')).ok).toBe(true)
  })

  it('keeps the stored hint count as a floor that a failed attempt cannot clear', async () => {
    const { checkRate } = await load()
    stub.state.hintCount = 5
    expect((await checkRate('u1', 'coach', 'hint-requested', 'ex_1')).ok).toBe(false)
    await checkRate('u1', 'diagnoser', 'attempt-failed', 'ex_1')
    const afterFailure = await checkRate('u1', 'coach', 'hint-requested', 'ex_1')
    expect(afterFailure.ok).toBe(false)
    expect(afterFailure.message).toMatch(/5 hints/)
  })

  it('backstops the coach at sixty recorded calls an hour', async () => {
    const { checkRate } = await load()
    stub.state.usageCount = 60
    expect((await checkRate('u1', 'coach', 'hint-requested', 'ex_1')).ok).toBe(false)
    stub.state.usageCount = 59
    vi.advanceTimersByTime(60_001)
    expect((await checkRate('u1', 'coach', 'hint-requested', 'ex_1')).ok).toBe(true)
  })
})
