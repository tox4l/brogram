import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACHIEVEMENTS, type UserAchievement } from '@/lib/contracts'
import { line, lineWith } from '@/lib/voice/lines'

// ---------------------------------------------------------------------------
// Shared fakes
// ---------------------------------------------------------------------------

class FakeMediaQueryList {
  matches: boolean
  private listeners = new Set<(event: { matches: boolean }) => void>()
  constructor(matches: boolean) { this.matches = matches }
  addEventListener(_type: 'change', listener: (event: { matches: boolean }) => void) { this.listeners.add(listener) }
  removeEventListener(_type: 'change', listener: (event: { matches: boolean }) => void) { this.listeners.delete(listener) }
  set(matches: boolean) {
    this.matches = matches
    for (const listener of this.listeners) listener({ matches })
  }
}

/** Installs `window.matchMedia` for `(prefers-reduced-motion: reduce)`, the
 *  only query every component here reads via `useReducedMotion()`. Any
 *  other query (e.g. `canvas-confetti`'s own internal
 *  `(prefers-reduced-motion)` check, without `: reduce`, inside its
 *  `disableForReducedMotion` handling) gets a harmless non-matching stub
 *  rather than a thrown error -- this suite only asserts on the one query
 *  that matters to this code, not on every query anything imported happens
 *  to make. */
function installMatchMedia(initial: boolean): FakeMediaQueryList {
  const mql = new FakeMediaQueryList(initial)
  window.matchMedia = ((query: string) => {
    if (query === '(prefers-reduced-motion: reduce)') return mql as unknown as MediaQueryList
    return new FakeMediaQueryList(false) as unknown as MediaQueryList
  }) as typeof window.matchMedia
  return mql
}

/** The one visible celebration card (there is also an always-present
 *  sr-only announcer with the same text, so tests that need to distinguish
 *  "the visible card says X" from "the SR announcement says X" scope into
 *  this element rather than a bare `screen.getByText`). */
function visibleCard(): HTMLElement {
  const el = document.querySelector<HTMLElement>('.pointer-events-auto')
  if (!el) throw new Error('no visible celebration card is rendered')
  return el
}

/** The one sr-only announcement channel every celebration renders through
 *  (fix round 1, I6), used for kinds with no visible card at all (chain,
 *  goal -- the pip/ring is the visual, this layer only sounds and announces). */
function liveText(): string {
  return document.querySelector('[aria-live="polite"]')?.textContent ?? ''
}

const gsapMocks = vi.hoisted(() => ({
  to: vi.fn(),
  set: vi.fn(),
  fromTo: vi.fn(),
  killTweensOf: vi.fn(),
}))

// A partial mock: `gsap.context`/`.add`/`.revert` (what `useGSAP` itself
// calls) stay real, so the hook's own mount/cleanup lifecycle is exercised
// for real; only the tween-creating calls this test suite needs to assert
// against become spies.
vi.mock('gsap', async (importOriginal) => {
  const actual = await importOriginal<typeof import('gsap')>()
  return { ...actual, gsap: { ...actual.gsap, to: gsapMocks.to, set: gsapMocks.set, fromTo: gsapMocks.fromTo, killTweensOf: gsapMocks.killTweensOf } }
})

const soundMocks = vi.hoisted(() => ({ play: vi.fn() }))
vi.mock('@/lib/sound/manager', () => ({ play: soundMocks.play }))

const confettiMock = vi.hoisted(() => vi.fn())
vi.mock('canvas-confetti', () => ({ default: confettiMock }))

const achievementsQueryMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/query/hooks', () => ({ useAchievements: achievementsQueryMock }))

const vibrateMock = vi.hoisted(() => vi.fn())

beforeEach(() => {
  installMatchMedia(false)
  Object.defineProperty(navigator, 'vibrate', { value: vibrateMock, configurable: true, writable: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// Confetti (fix round 2: a plain function, not a component -- see C1)
// ---------------------------------------------------------------------------

describe('fireConfetti / originFromRect', () => {
  it('fires the library, dynamically imported', async () => {
    const { fireConfetti } = await import('./Confetti')
    fireConfetti(false)
    await act(async () => { await Promise.resolve() })
    expect(confettiMock).toHaveBeenCalledTimes(1)
    expect(confettiMock).toHaveBeenCalledWith(expect.objectContaining({ disableForReducedMotion: true, origin: { x: 0.5, y: 0.35 } }))
  })

  it('under reduced motion, canvas-confetti is never imported or called', async () => {
    const { fireConfetti } = await import('./Confetti')
    fireConfetti(true)
    await act(async () => { await Promise.resolve() })
    expect(confettiMock).not.toHaveBeenCalled()
  })

  it('originFromRect converts a bounding rect into a viewport fraction', async () => {
    const { originFromRect } = await import('./Confetti')
    const rect = { left: 100, width: 40, top: 200 } as DOMRect
    const origin = originFromRect(rect)
    expect(origin).toEqual({ x: (100 + 20) / window.innerWidth, y: 200 / window.innerHeight })
  })

  it('originFromRect returns undefined with no rect', async () => {
    const { originFromRect } = await import('./Confetti')
    expect(originFromRect(null)).toBeUndefined()
    expect(originFromRect(undefined)).toBeUndefined()
  })

  // Note: `fireConfetti` itself carries no once-per-item gate by design --
  // that guarantee lives in the store (`markConfettiFired`) and is covered
  // by the Celebration-level C1 test below, which is also where the "once
  // per item, even across a remount" guarantee actually matters. A bare
  // "call it twice" test against the real `canvas-confetti` package is not
  // reliable under jsdom (no 2D canvas context without the native `canvas`
  // package), so that scenario is exercised at the level that matters.
})

// ---------------------------------------------------------------------------
// XpCounter
// ---------------------------------------------------------------------------

describe('XpCounter', () => {
  it('renders the initial value with tabular digits and an accessible label', async () => {
    const { XpCounter } = await import('./XpCounter')
    const { container } = render(<XpCounter value={1240} label="XP" />)
    expect(container.querySelector('span[aria-hidden="true"]')?.textContent).toBe('1,240')
    screen.getByText('1,240 XP') // throws if missing
  })

  it('counts up from the previous value toward the new one via the GSAP proxy tween', async () => {
    const { XpCounter } = await import('./XpCounter')
    const { rerender, container } = render(<XpCounter value={100} />)
    gsapMocks.to.mockClear()
    rerender(<XpCounter value={160} />)

    expect(gsapMocks.to).toHaveBeenCalledTimes(1)
    const [proxy, vars] = gsapMocks.to.mock.calls.at(-1)! as [{ v: number }, { onUpdate?: () => void }]
    const visible = () => container.querySelector('span[aria-hidden="true"]')

    proxy.v = 130
    act(() => vars.onUpdate?.())
    expect(visible()?.textContent).toBe('130')

    proxy.v = 160
    act(() => vars.onUpdate?.())
    expect(visible()?.textContent).toBe('160')
  })

  it('under reduced motion, no GSAP tween is created and the value sets in one frame', async () => {
    installMatchMedia(true)
    const { XpCounter } = await import('./XpCounter')
    const { rerender, container } = render(<XpCounter value={100} />)
    gsapMocks.to.mockClear()
    rerender(<XpCounter value={250} />)

    expect(gsapMocks.to).not.toHaveBeenCalled()
    expect(container.querySelector('span[aria-hidden="true"]')?.textContent).toBe('250')
  })

  it('does not tween when the value has not changed', async () => {
    const { XpCounter } = await import('./XpCounter')
    const { rerender } = render(<XpCounter value={50} />)
    gsapMocks.to.mockClear()
    rerender(<XpCounter value={50} />)
    expect(gsapMocks.to).not.toHaveBeenCalled()
  })

  it('fix round 1 I2: kills the previous tween before starting the next one, so two fast passes never run backwards', async () => {
    const { XpCounter } = await import('./XpCounter')
    const { rerender } = render(<XpCounter value={100} />)
    gsapMocks.killTweensOf.mockClear()
    rerender(<XpCounter value={160} />) // tween A: 100 -> 160
    const proxyA = gsapMocks.to.mock.calls.at(-1)![0]
    rerender(<XpCounter value={220} />) // lands ~600ms later: tween B must kill A first
    expect(gsapMocks.killTweensOf).toHaveBeenCalledWith(proxyA)
  })

  it('fix round 1 I3: plays xp.settle once the tween completes, never per frame', async () => {
    const { XpCounter } = await import('./XpCounter')
    const { rerender } = render(<XpCounter value={100} />)
    rerender(<XpCounter value={160} />)
    const vars = gsapMocks.to.mock.calls.at(-1)![1] as { onUpdate?: () => void; onComplete?: () => void }
    act(() => vars.onUpdate?.())
    expect(soundMocks.play).not.toHaveBeenCalledWith('xp.settle')
    act(() => vars.onComplete?.())
    expect(soundMocks.play).toHaveBeenCalledWith('xp.settle')
    expect(soundMocks.play).toHaveBeenCalledTimes(1)
  })

  it('fix round 1 I3: under reduced motion, xp.settle still plays immediately -- feedback reduces, it never vanishes', async () => {
    installMatchMedia(true)
    const { XpCounter } = await import('./XpCounter')
    const { rerender } = render(<XpCounter value={100} />)
    rerender(<XpCounter value={160} />)
    expect(soundMocks.play).toHaveBeenCalledWith('xp.settle')
  })
})

// ---------------------------------------------------------------------------
// LevelBadge
// ---------------------------------------------------------------------------

describe('LevelBadge', () => {
  it('always shows the number, never just the band', async () => {
    const { LevelBadge } = await import('./LevelBadge')
    render(<LevelBadge level={7} />)
    screen.getByText('Level 7')
    screen.getByText('Wired In')
  })

  it('plays the spring entrance via gsap.fromTo when animateEntrance is set', async () => {
    const { LevelBadge } = await import('./LevelBadge')
    render(<LevelBadge level={5} animateEntrance />)
    expect(gsapMocks.fromTo).toHaveBeenCalled()
    expect(gsapMocks.fromTo.mock.calls[0][1]).toMatchObject({ scale: 0.95 })
  })

  it('under reduced motion, the entrance is a plain opacity set-up, never a scale tween', async () => {
    installMatchMedia(true)
    const { LevelBadge } = await import('./LevelBadge')
    render(<LevelBadge level={5} animateEntrance />)
    expect(gsapMocks.fromTo).toHaveBeenCalled()
    const varsArg = gsapMocks.fromTo.mock.calls.at(-1)![1] as Record<string, unknown>
    expect(varsArg).not.toHaveProperty('scale')
  })
})

// ---------------------------------------------------------------------------
// StreakFlame
// ---------------------------------------------------------------------------

describe('StreakFlame', () => {
  it('renders the day count and an honest sr-only announcement per state', async () => {
    const { StreakFlame } = await import('./StreakFlame')
    render(<StreakFlame state="ignite" days={7} />)
    screen.getByText('7')
    screen.getByText('Day 7. Same time tomorrow.')
  })

  it('never renders a countdown or a guilt-trip line for at-risk', async () => {
    const { StreakFlame } = await import('./StreakFlame')
    render(<StreakFlame state="at-risk" days={4} />)
    expect(screen.queryByText(/lose|about to/i)).toBeNull()
  })

  it('under reduced motion, holds a static state instead of looping (gsap.set, not fromTo)', async () => {
    installMatchMedia(true)
    const { StreakFlame } = await import('./StreakFlame')
    render(<StreakFlame state="lit" days={3} />)
    expect(gsapMocks.set).toHaveBeenCalled()
    expect(gsapMocks.fromTo).not.toHaveBeenCalled()
  })

  it('lit state flickers via a looping opacity fromTo when motion is not reduced', async () => {
    const { StreakFlame } = await import('./StreakFlame')
    render(<StreakFlame state="lit" days={3} />)
    expect(gsapMocks.fromTo).toHaveBeenCalled()
    // fromTo(target, fromVars, toVars) -- the loop lives in the "to" vars (index 2).
    expect(gsapMocks.fromTo.mock.calls[0][2]).toMatchObject({ repeat: -1 })
  })
})

// ---------------------------------------------------------------------------
// GoalRing
// ---------------------------------------------------------------------------

describe('GoalRing', () => {
  it('reports progress via role=progressbar with the real values, never fabricated ones', async () => {
    const { GoalRing } = await import('./GoalRing')
    render(<GoalRing wins={2} goal={3} />)
    const ring = screen.getByRole('progressbar', { name: 'Daily goal' })
    expect(ring.getAttribute('aria-valuenow')).toBe('2')
    expect(ring.getAttribute('aria-valuemax')).toBe('3')
    screen.getByText('2/3')
  })

  it('shows the raw win count even past the goal (the ring fill is what clamps)', async () => {
    const { GoalRing } = await import('./GoalRing')
    render(<GoalRing wins={9} goal={3} />)
    screen.getByText('9/3')
  })

  it('fix round 1 I2: kills the previous tween before starting the next one', async () => {
    const { GoalRing } = await import('./GoalRing')
    const { rerender } = render(<GoalRing wins={1} goal={3} />)
    gsapMocks.killTweensOf.mockClear()
    rerender(<GoalRing wins={2} goal={3} />)
    expect(gsapMocks.killTweensOf).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// ChainPips
// ---------------------------------------------------------------------------

describe('ChainPips', () => {
  it('describes the chain honestly via one accessible label, never motion alone', async () => {
    const { ChainPips } = await import('./ChainPips')
    render(<ChainPips count={2} />)
    screen.getByRole('img', { name: '2 of 3 in a row' })
  })

  it('clamps to the 0-3 range', async () => {
    const { ChainPips } = await import('./ChainPips')
    render(<ChainPips count={7} />)
    screen.getByRole('img', { name: '3 of 3 in a row' })
  })
})

// ---------------------------------------------------------------------------
// TrophyCard
// ---------------------------------------------------------------------------

describe('TrophyCard', () => {
  const firstBlood = ACHIEVEMENTS.find((a) => a.id === 'first-blood')!

  it('renders a single unlock with its name and line, and dismisses on click', async () => {
    const { TrophyCard, achievementLine } = await import('./TrophyCard')
    const onDismiss = vi.fn()
    render(<TrophyCard achievement={firstBlood} onDismiss={onDismiss} />)
    screen.getByText(firstBlood.name)
    // Fix round 2, I1: first-blood's own `.line` in the frozen contracts.ts
    // still carries the banned "the whole product" wording; every read site
    // goes through `achievementLine()` instead, which maps it to the voice
    // bank's honest `pass.first` text.
    screen.getByText(achievementLine(firstBlood))
    expect(screen.queryByText(firstBlood.line)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('renders the collapsed "N new trophies" card and opens the shelf on request', async () => {
    const { TrophyCard } = await import('./TrophyCard')
    const onOpenShelf = vi.fn()
    render(<TrophyCard achievement={null} collapsedCount={3} onDismiss={() => {}} onOpenShelf={onOpenShelf} />)
    screen.getByText('3 new trophies')
    fireEvent.click(screen.getByRole('button', { name: 'Open the shelf' }))
    expect(onOpenShelf).toHaveBeenCalledTimes(1)
  })

  it('A11Y-13: only opacity transitions on the collapsed glyph reveal, never max-width, and it snaps under reduced motion', async () => {
    const { TrophyCard } = await import('./TrophyCard')
    const collapsedAchievements = [ACHIEVEMENTS.find((a) => a.id === 'no-wheels')!]

    const { unmount } = render(
      <TrophyCard achievement={null} collapsedCount={2} collapsedAchievements={collapsedAchievements} onDismiss={() => {}} />,
    )
    const revealFullMotion = screen.getByTestId('collapsed-reveal')
    expect(revealFullMotion.className).toContain('transition-opacity')
    expect(revealFullMotion.className).not.toMatch(/transition-all|transition-none/)
    unmount()

    installMatchMedia(true)
    render(<TrophyCard achievement={null} collapsedCount={2} collapsedAchievements={collapsedAchievements} onDismiss={() => {}} />)
    const revealReduced = screen.getByTestId('collapsed-reveal')
    expect(revealReduced.className).toContain('transition-none')
    expect(revealReduced.className).not.toContain('transition-opacity')
    // The width reveal itself is unchanged by the preference (fix round's own
    // ruling: dropping it would leave the invisible strip permanently
    // reserving layout) -- only whether it animates.
    expect(revealReduced.className).toContain('max-w-0')
    expect(revealReduced.className).toContain('group-hover:max-w-[240px]')
  })
})

// ---------------------------------------------------------------------------
// TrophyShelf
// ---------------------------------------------------------------------------

describe('TrophyShelf', () => {
  it('renders every achievement locked, showing its rule, when nothing is unlocked (empty state)', async () => {
    achievementsQueryMock.mockReturnValue({ data: [], isPending: false, isError: false })
    const { TrophyShelf } = await import('./TrophyShelf')
    render(<TrophyShelf />)
    screen.getByText('Nothing on the shelf yet. First pass puts something here.')
    screen.getByText(ACHIEVEMENTS[0].how)
    screen.getByText(ACHIEVEMENTS[0].name)
  })

  it('fix round 1 I5: on error, shows ONLY the error note -- never "nothing unlocked" stacked underneath it', async () => {
    achievementsQueryMock.mockReturnValue({ data: undefined, isPending: false, isError: true })
    const { TrophyShelf } = await import('./TrophyShelf')
    expect(() => render(<TrophyShelf />)).not.toThrow()
    screen.getByText(line('error.load'))
    screen.getByText(ACHIEVEMENTS[0].how)
    // A learner with real unlocks behind a failed query must never be told
    // their shelf is empty underneath the line saying it failed to load.
    expect(screen.queryByText('Nothing on the shelf yet. First pass puts something here.')).toBeNull()
  })

  it('shows an unlocked achievement lit with its date, and a locked one with its rule, side by side', async () => {
    const unlocked: UserAchievement[] = [{ userId: 'u1', achievementId: 'first-blood', unlockedAt: '2026-09-01T00:00:00.000Z' }]
    achievementsQueryMock.mockReturnValue({ data: unlocked, isPending: false, isError: false })
    const { TrophyShelf } = await import('./TrophyShelf')
    render(<TrophyShelf />)
    expect(screen.queryByText('Nothing on the shelf yet. First pass puts something here.')).toBeNull()
    screen.getByText(/Unlocked/)
    const locked = ACHIEVEMENTS.find((a) => a.id !== 'first-blood')!
    screen.getByText(locked.how)
  })
})

// ---------------------------------------------------------------------------
// Celebration -- the queue-driven layer
// ---------------------------------------------------------------------------

describe('Celebration', () => {
  async function freshCelebration() {
    vi.resetModules()
    const queueModule = await import('@/lib/rewards/useCelebration')
    const { Celebration } = await import('./Celebration')
    return { Celebration, celebrate: queueModule.celebrate }
  }

  it('renders exactly one card even when the queue holds more than one item', async () => {
    const { Celebration, celebrate } = await freshCelebration()
    render(<Celebration />)
    act(() => {
      celebrate('pass') // celebration-1, minor lane -- a compact chip
      celebrate('best') // celebration-2
    })
    // Only one visible celebration card renders, regardless of queue depth.
    expect(document.querySelectorAll('.pointer-events-auto').length).toBe(1)
    within(visibleCard()).getByText(line('pass', 'celebration-1'))
  })

  it('never fires a sound without also rendering its text (pass)', async () => {
    const { Celebration, celebrate } = await freshCelebration()
    render(<Celebration />)

    act(() => celebrate('pass'))
    expect(soundMocks.play).toHaveBeenCalledWith('pass')
    within(visibleCard()).getByText(line('pass', 'celebration-1'))
  })

  it('never fires a sound without also rendering its text, even for a kind with no visible card (chain -- (f): the pip animates in place, this layer only sounds and announces)', async () => {
    const { Celebration, celebrate } = await freshCelebration()
    render(<Celebration />)

    act(() => celebrate('chain', { n: 2 }))
    expect(soundMocks.play).toHaveBeenCalledWith('chain.tick')
    expect(document.querySelectorAll('.pointer-events-auto').length).toBe(0)
    expect(liveText()).toBe(lineWith('chain.tick', { n: 2 }, 'celebration-1'))
  })

  it("course-clear layers clo.close with level.up (both calls; the manager's own debounce picks the winner)", async () => {
    const { Celebration, celebrate } = await freshCelebration()
    render(<Celebration />)
    act(() => celebrate('course-clear'))
    expect(soundMocks.play).toHaveBeenCalledWith('clo.close')
    expect(soundMocks.play).toHaveBeenCalledWith('level.up')
  })

  it('a level-up is dismissable by keyboard (Escape)', async () => {
    const { Celebration, celebrate } = await freshCelebration()
    render(<Celebration />)
    act(() => celebrate('level-up', { level: 6 }))
    expect(visibleCard().querySelector('p')?.textContent).toMatch(/Level 6/)

    fireEvent.keyDown(window, { key: 'Escape' })
    // Motion's exit animation is asynchronous even when instant; poll for the
    // settled DOM rather than asserting the state change synchronously.
    await waitFor(() => expect(document.querySelectorAll('.pointer-events-auto').length).toBe(0))
  })

  it('fix round 1 C2: a level-up gets a real, bounded auto-dismiss (it is not the only way to end it, but it does end)', async () => {
    vi.useFakeTimers()
    const { Celebration, celebrate } = await freshCelebration()
    render(<Celebration />)
    act(() => celebrate('level-up', { level: 4 }))
    act(() => { vi.advanceTimersByTime(5_000) })
    expect(visibleCard().querySelector('p')?.textContent).toMatch(/Level 4/)
    act(() => { vi.advanceTimersByTime(2_500) }) // past the 7s bound -- triggers dismiss()
    // dismiss() has now fired at the JS level; Motion's own exit animation
    // runs on real animation frames fake timers do not drive, so switch back
    // before waiting for the DOM to actually settle (same shape as the
    // Escape-dismiss test above).
    vi.useRealTimers()
    await waitFor(() => expect(document.querySelectorAll('.pointer-events-auto').length).toBe(0))
  })

  it('the close button dismisses the current card and promotes the next one', async () => {
    const { Celebration, celebrate } = await freshCelebration()
    render(<Celebration />)
    act(() => {
      celebrate('level-up', { level: 3 }) // celebration-1
      celebrate('pass') // celebration-2
    })
    expect(visibleCard().querySelector('p')?.textContent).toMatch(/Level 3/)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => within(visibleCard()).getByText(line('pass', 'celebration-2')))
  })

  it('fires confetti only when the queued item earned it (session-first pass), not on a routine second pass', async () => {
    const { Celebration, celebrate } = await freshCelebration()
    render(<Celebration />)
    act(() => celebrate('pass'))
    await act(async () => { await Promise.resolve() })
    expect(confettiMock).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    confettiMock.mockClear()
    act(() => celebrate('pass'))
    await act(async () => { await Promise.resolve() })
    expect(confettiMock).not.toHaveBeenCalled()
  })

  it('under reduced motion, a confetti-eligible celebration still fires no confetti and no GSAP timeline', async () => {
    installMatchMedia(true)
    const { Celebration, celebrate } = await freshCelebration()
    render(<Celebration />)
    act(() => celebrate('first-win'))
    await act(async () => { await Promise.resolve() })
    expect(confettiMock).not.toHaveBeenCalled()
    expect(gsapMocks.fromTo).not.toHaveBeenCalled()
    // The text is still shown and the sound still plays -- feedback reduces, it never vanishes.
    expect(soundMocks.play).toHaveBeenCalledWith('first.win')
    within(visibleCard()).getByText(line('pass.first', 'celebration-1'))
  })

  it('A11Y-10: under reduced motion, a haptic-eligible celebration fires no vibration -- sound and text still land', async () => {
    installMatchMedia(true)
    const { Celebration, celebrate } = await freshCelebration()
    render(<Celebration />)
    act(() => celebrate('pass'))
    await act(async () => { await Promise.resolve() })
    expect(vibrateMock).not.toHaveBeenCalled()
    expect(soundMocks.play).toHaveBeenCalledWith('pass')
  })

  it('T4.8: the level-up path fires all its cues with motion on, and collapses to a cross-fade under reduced motion (haptic drops, sound and the headline text do not)', async () => {
    // Motion on: the level number and headline text render, the sound cue
    // fires, and the bonus haptic layer fires (HAPTIC_KINDS has 'level-up').
    const full = await freshCelebration()
    render(<full.Celebration />)
    act(() => full.celebrate('level-up', { level: 4, fromXp: 100, toXp: 220 }))
    await act(async () => { await Promise.resolve() })
    expect(soundMocks.play).toHaveBeenCalledWith('level.up')
    expect(vibrateMock).toHaveBeenCalled()
    expect(visibleCard().textContent).toContain('Level 4')

    cleanup()
    vi.clearAllMocks()

    // Reduced motion: the same cue and the same content still land --
    // "feedback reduces, it never vanishes" -- but the decorative haptic
    // layer, gated on the resolved boolean, does not fire.
    installMatchMedia(true)
    const reduced = await freshCelebration()
    render(<reduced.Celebration />)
    act(() => reduced.celebrate('level-up', { level: 5, fromXp: 220, toXp: 340 }))
    await act(async () => { await Promise.resolve() })
    expect(soundMocks.play).toHaveBeenCalledWith('level.up')
    expect(vibrateMock).not.toHaveBeenCalled()
    expect(visibleCard().textContent).toContain('Level 5')
  })

  it('small round 3: the epic moment renders its text on a `.celebration-plate`, not bare over the scrim', async () => {
    const { Celebration, celebrate } = await freshCelebration()
    render(<Celebration />)
    act(() => celebrate('first-win'))
    const plate = visibleCard().querySelector('.celebration-plate')
    expect(plate).not.toBeNull()
    // The line lives inside the plate, not as a sibling floating on the scrim.
    expect(plate?.textContent).toBe(line('pass.first', 'celebration-1'))
  })

  it('collapses three queued achievement unlocks into one card and opens the shelf on request', async () => {
    const onOpenShelf = vi.fn()
    const { Celebration, celebrate } = await freshCelebration()
    render(<Celebration onOpenShelf={onOpenShelf} />)
    act(() => {
      celebrate('achievement', { skill: 'first-blood' })
      celebrate('achievement', { skill: 'no-wheels' })
      celebrate('achievement', { skill: 'three-angles' })
    })
    within(visibleCard()).getByText('3 new trophies')
    fireEvent.click(screen.getByRole('button', { name: 'Open the shelf' }))
    expect(onOpenShelf).toHaveBeenCalledTimes(1)
  })

  it('plays no sound and shows no card when the queue is empty', async () => {
    const { Celebration } = await freshCelebration()
    render(<Celebration />)
    expect(soundMocks.play).not.toHaveBeenCalled()
    expect(document.querySelectorAll('.pointer-events-auto').length).toBe(0)
  })

  // ---------------------------------------------------------------------
  // Fix round 1, C1: no replay on preempt-and-return
  // ---------------------------------------------------------------------

  it('C1: a preempted item does not replay its sound, haptic or confetti when it returns to the front of the queue', async () => {
    const { Celebration, celebrate } = await freshCelebration()
    render(<Celebration />)

    act(() => celebrate('pass')) // celebration-1: session-first pass -- sound, haptic (buzz 15), confetti
    await act(async () => { await Promise.resolve() })
    expect(soundMocks.play).toHaveBeenCalledWith('pass')
    expect(soundMocks.play.mock.calls.filter((call) => call[0] === 'pass')).toHaveLength(1)
    expect(vibrateMock.mock.calls.filter((call) => call[0] === 15)).toHaveLength(1) // pass's own pattern
    expect(confettiMock).toHaveBeenCalledTimes(1)

    act(() => celebrate('level-up', { level: 5 })) // celebration-2: preempts pass (priority 90 > 70) -- also haptic
    await waitFor(() => expect(visibleCard().querySelector('p')?.textContent).toMatch(/Level 5/))

    // Dismissing level-up restores pass to the front -- the exact C1 scenario.
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => within(visibleCard()).getByText(line('pass', 'celebration-1')))

    // Nothing about pass fired a second time (level-up's own haptic pattern is untouched by this check).
    expect(soundMocks.play.mock.calls.filter((call) => call[0] === 'pass')).toHaveLength(1)
    expect(vibrateMock.mock.calls.filter((call) => call[0] === 15)).toHaveLength(1)
    expect(confettiMock).toHaveBeenCalledTimes(1)
  })

  // ---------------------------------------------------------------------
  // Fix round 1, C2: TTL -- a never-shown item does not survive past its
  // own lifetime, and is never promoted (with sound) on a later mount.
  // ---------------------------------------------------------------------

  it('C2: an item queued but never shown is dropped once its lifetime elapses, and is not promoted on a later mount', async () => {
    vi.useFakeTimers()
    const start = new Date('2026-01-01T00:00:00.000Z')
    vi.setSystemTime(start)
    const { Celebration, celebrate } = await freshCelebration()
    const { unmount } = render(<Celebration />)

    act(() => {
      celebrate('level-up', { level: 9 }) // celebration-1: shown (current), lifetime 7000ms
      celebrate('pass') // celebration-2: never shown -- outranked by level-up the whole time
    })
    expect(visibleCard().querySelector('p')?.textContent).toMatch(/Level 9/)
    soundMocks.play.mockClear()

    // A route change: the layer unmounts without either item having been dismissed.
    unmount()

    // Past pass's ~1.5s lifetime, well before level-up's 7s (irrelevant --
    // level-up was already cleared on unmount because it WAS shown).
    vi.setSystemTime(new Date(start.getTime() + 2_000))

    render(<Celebration />) // the next route mounts a fresh layer
    await act(async () => {})

    expect(document.querySelectorAll('.pointer-events-auto').length).toBe(0)
    expect(soundMocks.play).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------
  // Fix round 1, I8: idempotency
  // ---------------------------------------------------------------------

  it('I8: a repeated celebrate() call for the same eventId is a no-op while the first is still live', async () => {
    const { Celebration, celebrate } = await freshCelebration()
    render(<Celebration />)
    act(() => {
      celebrate('best', { n: 10 }, 'submit-42')
      celebrate('best', { n: 10 }, 'submit-42') // a StrictMode double-invoke / retried mutation
    })
    expect(soundMocks.play.mock.calls.filter((call) => call[0] === 'best')).toHaveLength(1)
  })

  // ---------------------------------------------------------------------
  // Fix round 2, C1: confetti tracked in the store, not a component ref --
  // a preempted-then-never-shown item must not burst again on a remount.
  // ---------------------------------------------------------------------

  it("C1 (fix round 2): a confetti item preempted before it showed does not burst again on the next route's mount", async () => {
    const { Celebration, celebrate } = await freshCelebration()
    const { unmount } = render(<Celebration />)

    act(() => celebrate('pass')) // celebration-1: session-first pass, confetti-eligible
    act(() => celebrate('level-up', { level: 5 })) // celebration-2: preempts immediately -- pass never becomes current
    await act(async () => { await Promise.resolve() })
    expect(confettiMock).toHaveBeenCalledTimes(1) // fired at enqueue, independent of visibility

    unmount() // route change: level-up (shown) is cleared, pass (never shown) survives
    confettiMock.mockClear()

    render(<Celebration />) // the next route mounts a fresh layer
    await act(async () => { await Promise.resolve() })
    expect(confettiMock).not.toHaveBeenCalled() // no second burst for the same pass item
  })

  it('C1 (fix round 2): a second collapsed achievement burst in the same session still plays its sound (unique id per burst)', async () => {
    const { Celebration, celebrate } = await freshCelebration()
    render(<Celebration />)
    act(() => {
      celebrate('achievement', { skill: 'first-blood' })
      celebrate('achievement', { skill: 'no-wheels' })
      celebrate('achievement', { skill: 'three-angles' })
    })
    await waitFor(() => within(visibleCard()).getByText('3 new trophies'))
    expect(soundMocks.play.mock.calls.filter((call) => call[0] === 'best')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(document.querySelectorAll('.pointer-events-auto').length).toBe(0))

    act(() => {
      celebrate('achievement', { skill: 'day-three' })
      celebrate('achievement', { skill: 'week-strong' })
      celebrate('achievement', { skill: 'thirty' })
    })
    await waitFor(() => within(visibleCard()).getByText('3 new trophies'))
    // A constant collapsed id would have already been in `firedSoundIds`
    // from the first burst and played nothing here.
    expect(soundMocks.play.mock.calls.filter((call) => call[0] === 'best')).toHaveLength(2)
  })

  // ---------------------------------------------------------------------
  // Fix round 2, C2: a shown collapsed achievement card must actually be
  // clearable -- its id is synthetic and no raw item carries it verbatim.
  // ---------------------------------------------------------------------

  it('C2 (fix round 2): a shown collapsed achievement card is cleared on unmount and does not reappear on the next mount', async () => {
    const { Celebration, celebrate } = await freshCelebration()
    const { unmount } = render(<Celebration />)
    act(() => {
      celebrate('achievement', { skill: 'first-blood' })
      celebrate('achievement', { skill: 'no-wheels' })
      celebrate('achievement', { skill: 'three-angles' })
    })
    await waitFor(() => within(visibleCard()).getByText('3 new trophies')) // shown
    unmount() // route change without dismissing

    render(<Celebration />)
    await act(async () => {})
    expect(document.querySelectorAll('.pointer-events-auto').length).toBe(0)
  })

  // ---------------------------------------------------------------------
  // Fix round 2, I7 regression: AnimatePresence must actually play an exit.
  // ---------------------------------------------------------------------

  it('I7 (fix round 2): an exit transition actually runs when the queue empties -- the card is not synchronously removed', async () => {
    const { Celebration, celebrate } = await freshCelebration()
    render(<Celebration />)
    act(() => celebrate('pass'))
    const card = visibleCard()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    // Immediately after dismiss, the card is still in the document -- Motion's
    // exit is in flight. A mis-nested `AnimatePresence` (inside the
    // `current && tier` conditional) would have unmounted it synchronously
    // in this same tick, with no exit ever playing.
    expect(document.body.contains(card)).toBe(true)
    await waitFor(() => expect(document.querySelectorAll('.pointer-events-auto').length).toBe(0))
  })
})
