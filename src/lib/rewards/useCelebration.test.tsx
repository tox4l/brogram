import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `useCelebration.ts` is a true module singleton (same shape as
 * `src/lib/sound/manager.ts`), so every test loads a fresh copy the same
 * way `manager.test.ts` does -- `vi.resetModules()` then a fresh dynamic
 * `import()` -- rather than exposing a test-only reset export from
 * production code.
 */
async function loadModule() {
  vi.resetModules()
  return import('./useCelebration')
}

let now = 1_000_000
function advance(ms: number) {
  now += ms
}

beforeEach(() => {
  now = 1_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('celebrate / useCelebration (pinned interface)', () => {
  it('celebrate() is stable across renders and queueLength reflects the queue', async () => {
    const mod = await loadModule()
    const { result } = renderHook(() => mod.useCelebration())
    expect(result.current.queueLength).toBe(0)

    act(() => result.current.celebrate('pass'))
    expect(result.current.queueLength).toBe(1)

    act(() => result.current.celebrate('best'))
    expect(result.current.queueLength).toBe(2)
  })

  it('every call site shares the same underlying queue (module singleton, not per-hook state)', async () => {
    const mod = await loadModule()
    const a = renderHook(() => mod.useCelebration())
    const b = renderHook(() => mod.useCelebration())

    act(() => a.result.current.celebrate('goal'))

    expect(a.result.current.queueLength).toBe(1)
    expect(b.result.current.queueLength).toBe(1)
  })
})

describe('queue order and priority', () => {
  it('same-priority events stay in arrival order (FIFO)', async () => {
    const mod = await loadModule()
    const { result } = renderHook(() => mod.useCelebrationQueue())
    act(() => {
      mod.celebrate('chain', { n: 1 })
      mod.celebrate('best')
    })
    expect(result.current.queue.map((item) => item.kind)).toEqual(['chain', 'best'])
  })

  it('a higher-priority event preempts a lower one that arrived first', async () => {
    const mod = await loadModule()
    const { result } = renderHook(() => mod.useCelebrationQueue())
    act(() => {
      mod.celebrate('pass')
      mod.celebrate('level-up', { level: 5 })
    })
    // level-up (90) outranks pass (70) even though pass was queued first.
    expect(result.current.current?.kind).toBe('level-up')
    expect(result.current.queue.map((item) => item.kind)).toEqual(['level-up', 'pass'])
  })

  it('first-win outranks everything, clo-close outranks a routine pass', async () => {
    const mod = await loadModule()
    const { result } = renderHook(() => mod.useCelebrationQueue())
    act(() => {
      mod.celebrate('pass')
      mod.celebrate('clo-close', { skill: 'Loops' })
      mod.celebrate('first-win')
    })
    expect(result.current.queue.map((item) => item.kind)).toEqual(['first-win', 'clo-close', 'pass'])
  })
})

describe('one at a time and dismiss', () => {
  it('current is always exactly the front of the queue, never more than one at once', async () => {
    const mod = await loadModule()
    const { result } = renderHook(() => mod.useCelebrationQueue())
    act(() => {
      mod.celebrate('pass')
      mod.celebrate('best')
    })
    expect(result.current.current?.kind).toBe('pass')
  })

  it('dismissing the current item promotes the next one', async () => {
    const mod = await loadModule()
    const { result } = renderHook(() => mod.useCelebrationQueue())
    act(() => {
      mod.celebrate('pass')
      mod.celebrate('best')
    })
    const firstId = result.current.current!.id
    act(() => result.current.dismiss(firstId))
    expect(result.current.current?.kind).toBe('best')
    expect(result.current.queue).toHaveLength(1)
  })

  it('dismissing an id not in the queue is a harmless no-op', async () => {
    const mod = await loadModule()
    const { result } = renderHook(() => mod.useCelebrationQueue())
    act(() => mod.celebrate('pass'))
    act(() => result.current.dismiss('not-a-real-id'))
    expect(result.current.queue).toHaveLength(1)
  })
})

describe('the achievement collapse (brief step 1)', () => {
  it('one or two pending achievements stay individual', async () => {
    const mod = await loadModule()
    const { result } = renderHook(() => mod.useCelebrationQueue())
    act(() => {
      mod.celebrate('achievement', { skill: 'first-blood' })
      mod.celebrate('achievement', { skill: 'no-wheels' })
    })
    const achievementItems = result.current.queue.filter((item) => item.kind === 'achievement')
    expect(achievementItems).toHaveLength(2)
  })

  it('a third pending achievement collapses all of them into one "3 new trophies" card', async () => {
    const mod = await loadModule()
    const { result } = renderHook(() => mod.useCelebrationQueue())
    act(() => {
      mod.celebrate('achievement', { skill: 'first-blood' })
      mod.celebrate('achievement', { skill: 'no-wheels' })
      mod.celebrate('achievement', { skill: 'three-angles' })
    })
    const achievementItems = result.current.queue.filter((item) => item.kind === 'achievement')
    expect(achievementItems).toHaveLength(1)
    expect(achievementItems[0].collapsedCount).toBe(3)
  })

  it('dismissing the collapsed card clears every achievement it represents', async () => {
    const mod = await loadModule()
    const { result } = renderHook(() => mod.useCelebrationQueue())
    act(() => {
      mod.celebrate('achievement', { skill: 'a' })
      mod.celebrate('achievement', { skill: 'b' })
      mod.celebrate('achievement', { skill: 'c' })
    })
    const collapsedId = result.current.queue.find((item) => item.kind === 'achievement')!.id
    act(() => result.current.dismiss(collapsedId))
    expect(result.current.queue.filter((item) => item.kind === 'achievement')).toHaveLength(0)
  })
})

describe('confetti eligibility and the 1200ms cooldown (brief step 1)', () => {
  it('the session’s first pass earns confetti; the second routine pass does not', async () => {
    const mod = await loadModule()
    const { result } = renderHook(() => mod.useCelebrationQueue())
    act(() => mod.celebrate('pass'))
    const first = result.current.current
    advance(5000) // well outside the cooldown -- this is testing session state, not the cooldown
    act(() => result.current.dismiss(first!.id))
    act(() => mod.celebrate('pass'))
    expect(first?.confetti).toBe(true)
    expect(result.current.current?.confetti).toBe(false)
  })

  it('a chain tick reaching exactly 3 earns confetti; other ticks do not', async () => {
    const mod = await loadModule()
    const { result } = renderHook(() => mod.useCelebrationQueue())
    act(() => mod.celebrate('chain', { n: 1 }))
    expect(result.current.current?.confetti).toBe(false)
    advance(5000)
    act(() => result.current.dismiss(result.current.current!.id))
    act(() => mod.celebrate('chain', { n: 3 }))
    expect(result.current.current?.confetti).toBe(true)
  })

  it('a streak milestone earns confetti; an ordinary streak ignite does not', async () => {
    const mod = await loadModule()
    const { result } = renderHook(() => mod.useCelebrationQueue())
    act(() => mod.celebrate('streak-ignite', { n: 2 }))
    expect(result.current.current?.confetti).toBe(false)
    advance(5000)
    act(() => result.current.dismiss(result.current.current!.id))
    act(() => mod.celebrate('streak-milestone', { n: 7 }))
    expect(result.current.current?.confetti).toBe(true)
  })

  it('two confetti-eligible celebrations inside 1200ms produce exactly one confetti', async () => {
    const mod = await loadModule()
    const { result } = renderHook(() => mod.useCelebrationQueue())
    act(() => mod.celebrate('first-win'))
    advance(500) // well inside the 1200ms cooldown
    act(() => mod.celebrate('chain', { n: 3 }))

    const confettiCount = result.current.queue.filter((item) => item.confetti).length
    expect(confettiCount).toBe(1)
    expect(result.current.queue.find((item) => item.kind === 'first-win')?.confetti).toBe(true)
    expect(result.current.queue.find((item) => item.kind === 'chain')?.confetti).toBe(false)
  })

  it('two confetti-eligible celebrations 1200ms apart both earn confetti', async () => {
    const mod = await loadModule()
    const { result } = renderHook(() => mod.useCelebrationQueue())
    act(() => mod.celebrate('first-win'))
    advance(1200)
    act(() => mod.celebrate('streak-milestone', { n: 3 }))

    expect(result.current.queue.every((item) => item.confetti)).toBe(true)
  })

  it('kinds outside the confetti list never earn one, cooldown or not', async () => {
    const mod = await loadModule()
    const { result } = renderHook(() => mod.useCelebrationQueue())
    act(() => {
      mod.celebrate('level-up', { level: 5 })
      mod.celebrate('clo-close', { skill: 'Loops' })
      mod.celebrate('course-clear')
      mod.celebrate('best')
      mod.celebrate('goal')
      mod.celebrate('achievement', { skill: 'x' })
    })
    expect(result.current.queue.some((item) => item.confetti)).toBe(false)
  })
})

describe('levelUpDetail (level-up detection to presentation)', () => {
  it('returns null when no level boundary was crossed', async () => {
    const mod = await loadModule()
    expect(mod.levelUpDetail(0, 10)).toBeNull() // both level 1
  })

  it('reports the level reached on an ordinary single-level-up pass', async () => {
    const mod = await loadModule()
    // xpToReach(2) = 500
    expect(mod.levelUpDetail(400, 600)).toEqual({ level: 2, n: 1, fromXp: 400, toXp: 600 })
  })

  it('reports every level crossed when a jump spans more than one boundary', async () => {
    const mod = await loadModule()
    // xpToReach(2)=500, xpToReach(3)=1400: 400 -> 1400 crosses levels 2 and 3.
    const result = mod.levelUpDetail(400, 1400)
    expect(result?.level).toBe(3)
    expect(result?.n).toBe(2)
  })

  it('never reports a crossing when XP moves backward', async () => {
    const mod = await loadModule()
    expect(mod.levelUpDetail(1400, 400)).toBeNull()
  })
})

describe('celebrate() idempotency (fix round 1, I8)', () => {
  it('a repeated eventId is a no-op while the first item is still in the queue', async () => {
    const mod = await loadModule()
    const { result } = renderHook(() => mod.useCelebrationQueue())
    act(() => {
      mod.celebrate('best', { n: 5 }, 'submit-1')
      mod.celebrate('best', { n: 5 }, 'submit-1')
      mod.celebrate('best', { n: 5 }, 'submit-1')
    })
    expect(result.current.queue).toHaveLength(1)
  })

  it('a different eventId is a distinct celebration', async () => {
    const mod = await loadModule()
    const { result } = renderHook(() => mod.useCelebrationQueue())
    act(() => {
      mod.celebrate('best', { n: 5 }, 'submit-1')
      mod.celebrate('best', { n: 6 }, 'submit-2')
    })
    expect(result.current.queue).toHaveLength(2)
  })

  it('no eventId at all never dedupes -- every plain call is its own celebration', async () => {
    const mod = await loadModule()
    const { result } = renderHook(() => mod.useCelebrationQueue())
    act(() => {
      mod.celebrate('best', { n: 5 })
      mod.celebrate('best', { n: 5 })
    })
    expect(result.current.queue).toHaveLength(2)
  })

  it('the same eventId can fire again once the first item has left the queue', async () => {
    const mod = await loadModule()
    const { result } = renderHook(() => mod.useCelebrationQueue())
    act(() => mod.celebrate('best', { n: 5 }, 'submit-1'))
    act(() => result.current.dismiss(result.current.current!.id))
    act(() => mod.celebrate('best', { n: 5 }, 'submit-1'))
    expect(result.current.queue).toHaveLength(1)
  })
})

describe('the staleness TTL (fix round 1, C2)', () => {
  it('a queued item is dropped on the next read once its own lifetime has elapsed', async () => {
    const mod = await loadModule()
    const { result } = renderHook(() => mod.useCelebrationQueue())
    act(() => mod.celebrate('pass')) // base lifetime 1500ms
    expect(result.current.queue).toHaveLength(1)
    advance(1600)
    act(() => mod.celebrate('best', { n: 1 })) // any read/write re-evaluates staleness
    expect(result.current.queue.find((item) => item.kind === 'pass')).toBeUndefined()
  })

  it('a fresh item within its lifetime survives a read', async () => {
    const mod = await loadModule()
    const { result } = renderHook(() => mod.useCelebrationQueue())
    act(() => mod.celebrate('level-up', { level: 5 })) // base lifetime 7000ms
    advance(3000)
    act(() => mod.celebrate('best', { n: 1 }))
    expect(result.current.queue.find((item) => item.kind === 'level-up')).toBeDefined()
  })

  it('clearShownCelebrations removes exactly the ids given, leaving the rest queued', async () => {
    const mod = await loadModule()
    const { result } = renderHook(() => mod.useCelebrationQueue())
    act(() => {
      mod.celebrate('pass')
      mod.celebrate('best', { n: 1 })
    })
    const shownId = result.current.queue[0].id
    act(() => mod.clearShownCelebrations(new Set([shownId])))
    expect(result.current.queue).toHaveLength(1)
    expect(result.current.queue[0].id).not.toBe(shownId)
  })
})

describe('the same-submit time budget (fix round 1, I4b)', () => {
  it('two routine events landing together keep their normal lifetime', async () => {
    const mod = await loadModule()
    const { result } = renderHook(() => mod.useCelebrationQueue())
    act(() => {
      mod.celebrate('pass') // 1500ms base
      mod.celebrate('best', { n: 1 }) // 1400ms base
    })
    const total = result.current.queue.reduce((sum, item) => sum + item.lifetimeMs, 0)
    expect(total).toBe(1500 + 1400)
  })

  it('a third routine event in the same ~300ms submit shrinks the whole batch to fit a ~3s budget', async () => {
    const mod = await loadModule()
    const { result } = renderHook(() => mod.useCelebrationQueue())
    act(() => {
      mod.celebrate('pass')
      mod.celebrate('best', { n: 1 })
      mod.celebrate('chain', { n: 1 })
    })
    for (const item of result.current.queue) {
      expect(item.lifetimeMs).toBeLessThanOrEqual(1000) // 3000 / 3
    }
    const total = result.current.queue.reduce((sum, item) => sum + item.lifetimeMs, 0)
    expect(total).toBeLessThanOrEqual(3000)
  })

  it('level-up and achievement are exempt from the batch cap', async () => {
    const mod = await loadModule()
    const { result } = renderHook(() => mod.useCelebrationQueue())
    act(() => {
      mod.celebrate('pass')
      mod.celebrate('best', { n: 1 })
      mod.celebrate('level-up', { level: 5 })
    })
    const levelUp = result.current.queue.find((item) => item.kind === 'level-up')
    expect(levelUp?.lifetimeMs).toBe(7000)
  })

  it('events well outside the 300ms window are never batched together', async () => {
    const mod = await loadModule()
    const { result } = renderHook(() => mod.useCelebrationQueue())
    act(() => mod.celebrate('pass'))
    advance(1000)
    act(() => mod.celebrate('best', { n: 1 }))
    advance(1000)
    act(() => mod.celebrate('chain', { n: 1 }))
    for (const item of result.current.queue) {
      const base = item.kind === 'pass' ? 1500 : item.kind === 'best' ? 1400 : 1200
      expect(item.lifetimeMs).toBe(base)
    }
  })
})
