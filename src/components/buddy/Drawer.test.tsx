import type { PropsWithChildren } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import type { User } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEnvelope, AgentError, BuddyReply, LearnerState } from '@/lib/contracts'
import { makeQueryClient } from '@/lib/query/client'
import { qk } from '@/lib/query/keys'
import { LINE_BANK, line } from '@/lib/voice/lines'
import { SessionProvider } from '@/components/shell/SessionProvider'
import { BuddyButton } from '@/components/shell/BuddyButton'
import { BuddyDrawer } from './Drawer'
import { buddyMessagesKey, REFUSAL, type BuddyMessage } from './state'

const spies = vi.hoisted(() => ({ stream: vi.fn(), from: vi.fn(), pathname: vi.fn(() => '/dashboard') }))
vi.mock('@/lib/agents/client', () => ({ streamAgent: spies.stream }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: spies.from }) }))
vi.mock('next/navigation', () => ({ usePathname: () => spies.pathname() }))

type Row = { id: string; role: 'user' | 'assistant'; content: string; created_at: string }
let rows: Row[]

function supabaseBuilder() {
  let action: 'select' | 'insert' = 'select'
  let payload: Record<string, unknown> | undefined
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    insert: (value: Record<string, unknown>) => { action = 'insert'; payload = value; return builder },
    // The motion-preference read (`fetchWellnessRow`) is the only caller of `.maybeSingle()` in
    // this drawer -- no wellness row in these tests, so `resolveWellnessPrefs(null)` defaults to
    // `motion: 'system'`.
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (resolve: (result: { data: Row[] | null; error: null }) => unknown) => {
      if (action === 'insert') {
        const row: Row = { id: `row-${rows.length}`, role: payload!.role as 'user' | 'assistant', content: String(payload!.content), created_at: new Date(Date.now() + rows.length).toISOString() }
        rows.push(row)
        return Promise.resolve(resolve({ data: null, error: null }))
      }
      const descending = [...rows].reverse().slice(0, 50)
      return Promise.resolve(resolve({ data: descending, error: null }))
    },
  }
  return builder
}

const learnerState: LearnerState = {
  userId: 'student',
  profile: { displayName: 'Student', learningStyle: 'mixed', styleVector: { visual: 0.5, verbal: 0.5, example: 0.5, theory: 0.5 }, tone: 'supportive', verbosity: 'short', motivation: { why: 'growth', beyondCourses: false, depth: 'understand', wantsAgenticCoding: false }, onboardingComplete: true },
  currentCourse: 'INFS1101',
  path: ['INFS1101-1'],
  nextExerciseIds: ['ex-1', 'ex-2'],
  mastery: { 'INFS1101-1': { userId: 'student', cloId: 'INFS1101-1', score: 40, chain: 1, patternsPassed: ['scan'], closed: false, lastAttemptAt: null } },
  recentMistakes: [{ exerciseId: 'e1', cloId: 'INFS1101-1', pattern: 'scan', label: 'off-by-one in range', at: '2026-09-01T00:00:00Z' }],
  streak: { exerciseDays: 3, derotDays: 0, lastExerciseDate: '2026-09-05', lastDerotDate: null },
  points: 500,
  integrityScore: 0,
  accountStatus: 'active',
  version: 4,
  updatedAt: '2026-09-05T00:00:00Z',
}

function envelope(reply: BuddyReply): AgentEnvelope<BuddyReply> {
  return { ok: true, agent: 'buddy', reply, fallback: false, usage: { promptTokens: 1, completionTokens: 1, cacheHitTokens: 0 } }
}

function setup(onOpenChange = vi.fn(), options?: { open?: boolean; queryClient?: QueryClient; learnerState?: LearnerState }) {
  const initial = { user: { id: 'student' } as User, profile: { id: 'student', account_status: 'active' as const, restricted_until: null }, learnerState: options?.learnerState ?? learnerState }
  const queryClient = options?.queryClient ?? makeQueryClient()
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>
      <SessionProvider initialState={initial}>{children}</SessionProvider>
    </QueryClientProvider>
  )
  return { ...render(<BuddyDrawer open={options?.open ?? true} onOpenChange={onOpenChange} />, { wrapper }), onOpenChange, queryClient }
}

async function typeAndSend(text: string) {
  const textarea = screen.getByLabelText('Message your Buddy')
  fireEvent.change(textarea, { target: { value: text } })
  fireEvent.keyDown(textarea, { key: 'Enter' })
}

beforeEach(() => {
  vi.clearAllMocks()
  rows = []
  spies.from.mockImplementation(supabaseBuilder)
  spies.pathname.mockReturnValue('/dashboard')
})

afterEach(() => { cleanup() })

describe('buddy drawer', () => {
  it('renders the empty state with no unhandled rejection when history fails to load', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    spies.from.mockImplementation(() => {
      const rejectingBuilder = {
        select: () => rejectingBuilder,
        eq: () => rejectingBuilder,
        order: () => rejectingBuilder,
        limit: () => rejectingBuilder,
        then: (_resolve: unknown, reject: (error: Error) => void) => Promise.reject(new Error('history unavailable')).catch(reject),
      }
      return rejectingBuilder
    })
    setup()
    await screen.findByText('Ask about the code you are stuck on, or why an angle keeps failing.')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('loads history only when opened and calls no agent on mount', async () => {
    rows = [{ id: 'r1', role: 'user', content: 'hello there', created_at: '2026-09-05T00:00:00.000Z' }]
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={makeQueryClient()}>
        <SessionProvider initialState={{ user: { id: 'student' } as User, profile: null, learnerState }}>{children}</SessionProvider>
      </QueryClientProvider>
    )
    const onOpenChange = vi.fn()
    const { rerender } = render(<BuddyDrawer open={false} onOpenChange={onOpenChange} />, { wrapper })
    expect(spies.from).not.toHaveBeenCalled()
    expect(spies.stream).not.toHaveBeenCalled()
    rerender(<BuddyDrawer open={true} onOpenChange={onOpenChange} />)
    await screen.findByText('hello there')
    expect(spies.from).toHaveBeenCalledWith('buddy_messages')
    // Plus the motion-preference read (I3), gated on `open` the same way -- still nothing beyond
    // these two reads, and still no agent call.
    expect(spies.from).toHaveBeenCalledWith('wellness')
    expect(spies.from).toHaveBeenCalledTimes(2)
    expect(spies.stream).not.toHaveBeenCalled()
  })

  it('sends exactly the last 6 messages and the allowed state keys only', async () => {
    rows = Array.from({ length: 7 }, (_, i) => ({ id: `m${i}`, role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant', content: `m${i}`, created_at: `2026-09-05T00:00:0${i}.000Z` }))
    spies.stream.mockResolvedValue(envelope({ onTopic: true, reply: 'Noted.' }))
    setup()
    await screen.findByText('m6')
    await typeAndSend('the newest question')
    await waitFor(() => expect(spies.stream).toHaveBeenCalledTimes(1))
    const [req] = spies.stream.mock.calls[0]
    expect(req.messages).toEqual([
      { role: 'user', content: 'm2' },
      { role: 'assistant', content: 'm3' },
      { role: 'user', content: 'm4' },
      { role: 'assistant', content: 'm5' },
      { role: 'user', content: 'm6' },
      { role: 'user', content: 'the newest question' },
    ])
    expect(Object.keys(req.state).sort()).toEqual(['accountStatus', 'integrityScore', 'mastery', 'nextExerciseIds', 'profile', 'recentMistakes', 'streak', 'userId', 'version'].sort())
    expect(req.state).toEqual({
      userId: learnerState.userId,
      version: learnerState.version,
      profile: learnerState.profile,
      mastery: learnerState.mastery,
      recentMistakes: learnerState.recentMistakes,
      streak: learnerState.streak,
      integrityScore: learnerState.integrityScore,
      accountStatus: learnerState.accountStatus,
      nextExerciseIds: learnerState.nextExerciseIds,
    })
  })

  it('renders partial frames then replaces them with the committed envelope text', async () => {
    let finish!: (value: AgentEnvelope<BuddyReply>) => void
    spies.stream.mockImplementationOnce((_req, onPartial) => {
      onPartial({ onTopic: true, reply: 'Partial answer building up' })
      return new Promise(resolve => { finish = resolve })
    })
    setup()
    await typeAndSend('why do i keep failing loops')
    await screen.findByText('Partial answer building up')
    expect(screen.getByText('▍', { exact: false })).toBeTruthy()
    await act(async () => { finish(envelope({ onTopic: true, reply: 'You keep failing on off-by-one errors in loops.' })) })
    await screen.findByText('You keep failing on off-by-one errors in loops.')
    expect(screen.queryByText('Partial answer building up')).toBeNull()
  })

  it('shows the exact refusal sentence without a cursor or suggestion chip when off topic', async () => {
    spies.stream.mockResolvedValue(envelope({ onTopic: false, reply: REFUSAL }))
    setup()
    await typeAndSend('what is the capital of France')
    await screen.findByText(REFUSAL)
    expect(screen.queryByText('▍', { exact: false })).toBeNull()
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })

  it.each([
    ['exercise', 'ex-9', '/exercise/ex-9'],
    ['derot', 'trace', '/derot?drill=trace'],
    ['break', 'pomodoro', '#pomodoro'],
  ] as const)('renders a %s suggestion chip with the right href', async (kind, ref, href) => {
    spies.stream.mockResolvedValue(envelope({ onTopic: true, reply: 'Here is a nudge.', suggestion: { kind, ref } }))
    setup()
    await typeAndSend('i feel scattered today')
    const link = await screen.findByRole('link')
    expect(link.getAttribute('href')).toBe(href)
  })

  it('points the break chip at the pomodoro anchor and closes the drawer before navigating on a dashboard path', async () => {
    spies.pathname.mockReturnValue('/dashboard')
    spies.stream.mockResolvedValue(envelope({ onTopic: true, reply: 'Take a moment.', suggestion: { kind: 'break', ref: 'pomodoro' } }))
    const { onOpenChange } = setup()
    await typeAndSend('i have been at this for two hours straight')
    const link = await screen.findByRole('link')
    expect(link.getAttribute('href')).toBe('#pomodoro')
    expect(onOpenChange).not.toHaveBeenCalled()
    fireEvent.click(link)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('falls back the break chip to /dashboard#pomodoro and still closes the drawer on an exercise page', async () => {
    spies.pathname.mockReturnValue('/exercise/ex-1')
    spies.stream.mockResolvedValue(envelope({ onTopic: true, reply: 'Take a moment.', suggestion: { kind: 'break', ref: 'pomodoro' } }))
    const { onOpenChange } = setup()
    await typeAndSend('i have been at this for two hours straight')
    const link = await screen.findByRole('link')
    expect(link.getAttribute('href')).toBe('/dashboard#pomodoro')
    fireEvent.click(link)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('renders an AgentError inline and re-enables the input', async () => {
    const rateLimited: AgentError = { ok: false, agent: 'buddy', error: 'rate-limited', message: 'buddy is limited to 20 per hour' }
    spies.stream.mockRejectedValue(rateLimited)
    setup()
    await typeAndSend('another question')
    await screen.findByText('buddy is limited to 20 per hour')
    const textarea = screen.getByLabelText('Message your Buddy') as HTMLTextAreaElement
    expect(textarea.disabled).toBe(false)
  })

  it('never keeps more than 50 messages locally', async () => {
    rows = Array.from({ length: 50 }, (_, i) => ({ id: `m${i}`, role: 'user' as const, content: `m${i}`, created_at: `2026-09-05T00:00:${String(i).padStart(2, '0')}.000Z` }))
    spies.stream.mockResolvedValue(envelope({ onTopic: true, reply: 'ok' }))
    setup()
    await screen.findByText('m49')
    expect(screen.getAllByTestId('buddy-message')).toHaveLength(50)
    await typeAndSend('one more')
    await waitFor(() => expect(screen.getAllByTestId('buddy-message')).toHaveLength(50))
    expect(screen.queryByText('m0')).toBeNull()
    expect(screen.queryByText('m1')).toBeNull()
    expect(screen.getByText('one more')).toBeTruthy()
  })

  it('marks a failed send "didn\'t send" without deleting it, and resends the same content on retry', async () => {
    const rateLimited: AgentError = { ok: false, agent: 'buddy', error: 'rate-limited', message: 'buddy is limited to 20 per hour' }
    spies.stream.mockRejectedValueOnce(rateLimited)
    spies.stream.mockResolvedValueOnce(envelope({ onTopic: true, reply: 'Got it now.' }))
    setup()
    await typeAndSend('why does this loop fail')
    const failedLine = line('buddy.failed')
    await screen.findByText(failedLine)
    expect(screen.getByText('why does this loop fail')).toBeTruthy()
    expect(spies.stream).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText(failedLine))
    await screen.findByText('Got it now.')
    expect(spies.stream).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(failedLine)).toBeNull()
    expect(screen.getByText('why does this loop fail')).toBeTruthy()
  })

  it('flips to sending synchronously, before any await, so a second Enter cannot start a second concurrent turn (C2)', async () => {
    // Never resolves -- if a second `buddy-message` turn started, this mock would be consumed
    // twice with nothing queued for the second call, which the assertion below rules out directly.
    spies.stream.mockImplementationOnce(() => new Promise<AgentEnvelope<BuddyReply>>(() => {}))
    setup()
    const textarea = screen.getByLabelText('Message your Buddy') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'first question' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    // Disabled and typing immediately -- not after the (fire-and-forget) insert settles.
    expect(textarea.disabled).toBe(true)
    expect(screen.getByText('Buddy is typing')).toBeTruthy()
    fireEvent.change(textarea, { target: { value: 'second question' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    // Let the first turn's own (fire-and-forget) async chain actually reach `streamAgent` before
    // asserting it was never called a second time.
    await waitFor(() => expect(spies.stream).toHaveBeenCalled())
    expect(spies.stream).toHaveBeenCalledTimes(1)
  })

  it('locks the auto-scroll once the learner scrolls away from the bottom mid-stream', async () => {
    let deliverPartial!: (partial: Partial<BuddyReply>) => void
    spies.stream.mockImplementationOnce((_req, onPartial) => {
      deliverPartial = onPartial
      onPartial({ onTopic: true, reply: 'first chunk' })
      return new Promise<AgentEnvelope<BuddyReply>>(() => {})
    })
    setup()
    await typeAndSend('why do i keep failing loops')
    await screen.findByText('first chunk')
    const scrollEl = screen.getByTestId('buddy-scroll')
    Object.defineProperty(scrollEl, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 300 })
    scrollEl.scrollTop = 0 // the learner scrolled all the way up to read back
    fireEvent.scroll(scrollEl)
    act(() => { deliverPartial({ onTopic: true, reply: 'first chunk continues streaming further' }) })
    await screen.findByText('first chunk continues streaming further')
    expect(scrollEl.scrollTop).toBe(0)
  })

  it('does not yank the learner back to the bottom the instant the reply commits (I1)', async () => {
    let finish!: (value: AgentEnvelope<BuddyReply>) => void
    spies.stream.mockImplementationOnce((_req, onPartial) => {
      onPartial({ onTopic: true, reply: 'streaming in' })
      return new Promise<AgentEnvelope<BuddyReply>>(resolve => { finish = resolve })
    })
    setup()
    await typeAndSend('why do i keep failing loops')
    await screen.findByText('streaming in')
    const scrollEl = screen.getByTestId('buddy-scroll')
    Object.defineProperty(scrollEl, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 300 })
    scrollEl.scrollTop = 0 // the learner scrolled up to reread an earlier exchange
    fireEvent.scroll(scrollEl)
    await act(async () => { finish(envelope({ onTopic: true, reply: 'the committed reply lands here' })) })
    await screen.findByText('the committed reply lands here')
    expect(scrollEl.scrollTop).toBe(0)
  })

  it('paints a cached conversation with no fetch before first paint on a reopened drawer', () => {
    const client = makeQueryClient()
    const cached: BuddyMessage[] = [{ id: 'cached-1', role: 'assistant', content: 'cached reply from a prior open', createdAt: '2026-09-05T00:00:00.000Z' }]
    client.setQueryData(buddyMessagesKey('student'), cached)
    // Also pre-seed the motion-preference read (I3) so the drawer paints from cache with truly
    // zero fetches, not just for the conversation.
    client.setQueryData(qk.wellness('student'), {})
    setup(vi.fn(), { queryClient: client })
    expect(screen.getByText('cached reply from a prior open')).toBeTruthy()
    expect(spies.from).not.toHaveBeenCalled()
  })

  it('frames a hard-failure derot suggestion as a Playground card linking straight at the runner', async () => {
    // A live run per C1: three misses inside the 30-minute window, none of them since cleared by
    // a pass (no mastery entry for the CLO at all here).
    const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()
    const hardFailureState: LearnerState = {
      ...learnerState,
      recentMistakes: [minutesAgo(20), minutesAgo(10), minutesAgo(2)].map((at, i) => ({ exerciseId: `e${i}`, cloId: 'INFS1101-1' as const, pattern: 'scan' as const, label: 'off-by-one in range', at })),
      mastery: {},
      updatedAt: new Date().toISOString(),
    }
    spies.stream.mockResolvedValue(envelope({ onTopic: true, reply: 'Rough one.', suggestion: { kind: 'derot', ref: 'trace' } }))
    setup(vi.fn(), { learnerState: hardFailureState })
    await typeAndSend('i keep failing this one')
    const link = await screen.findByRole('link')
    expect(link.getAttribute('href')).toBe('/derot/play/breathe')
    expect(LINE_BANK['buddy.suggest.play'].variants).toContain(link.textContent)
  })

  it('frames a long-idle-gap derot suggestion as an Arcade card, keeping the existing deep-link redirect', async () => {
    // C1's own failure scenario: three real fails, but from long enough ago (and long enough
    // since any activity) that this is idle time, not a run in progress -- not the `[]` fixture
    // that made the original test pass for the wrong reason.
    const sixWeeksAgo = '2020-01-01T00:00:00.000Z'
    const idleGapState: LearnerState = {
      ...learnerState,
      recentMistakes: [0, 1, 2].map(i => ({ exerciseId: `old-${i}`, cloId: 'INFS1101-1' as const, pattern: 'scan' as const, label: 'off-by-one in range', at: sixWeeksAgo })),
      updatedAt: sixWeeksAgo,
    }
    spies.stream.mockResolvedValue(envelope({ onTopic: true, reply: 'Been a while.', suggestion: { kind: 'derot', ref: 'trace' } }))
    setup(vi.fn(), { learnerState: idleGapState })
    await typeAndSend('what should i do next')
    const link = await screen.findByRole('link')
    expect(link.getAttribute('href')).toBe('/derot?drill=trace')
    expect(LINE_BANK['buddy.suggest.arcade'].variants).toContain(link.textContent)
  })

  it('has a live region so a landed reply is announced, and an sr-only label while typing', async () => {
    spies.stream.mockResolvedValue(envelope({ onTopic: true, reply: 'announced reply' }))
    setup()
    expect(screen.getByRole('log')).toBeTruthy()
    await typeAndSend('why do i keep failing loops')
    expect(screen.getByText('Buddy is typing')).toBeTruthy()
    await screen.findByText('announced reply')
  })

  // A11Y-07: the streaming preview used to be a bare text node inside the `role="log"` region,
  // rewritten on every SSE frame -- dozens of announcements for one reply. It is now
  // `aria-hidden`, so the region's *announced* content (what a screen reader would actually
  // read -- everything except aria-hidden subtrees) must stay put through the whole stream and
  // change exactly once, when the real committed message lands.
  it('does not change the log’s announced text while a reply streams, only once when it commits (A11Y-07)', async () => {
    let deliverPartial!: (partial: Partial<BuddyReply>) => void
    let finish!: (value: AgentEnvelope<BuddyReply>) => void
    spies.stream.mockImplementationOnce((_req, onPartial) => {
      deliverPartial = onPartial
      onPartial({ onTopic: true, reply: 'partial one' })
      return new Promise<AgentEnvelope<BuddyReply>>(resolve => { finish = resolve })
    })
    setup()
    await typeAndSend('why do i keep failing loops')
    await screen.findByText('partial one')
    const log = screen.getByRole('log')
    const announced = () => {
      const clone = log.cloneNode(true) as HTMLElement
      clone.querySelectorAll('[aria-hidden="true"]').forEach(node => node.remove())
      return clone.textContent
    }
    const duringStream = announced()
    act(() => { deliverPartial({ onTopic: true, reply: 'partial one two' }) })
    await screen.findByText('partial one two')
    act(() => { deliverPartial({ onTopic: true, reply: 'partial one two three' }) })
    await screen.findByText('partial one two three')
    // Real DOM mutations happened (the preview visibly grew) but none of them touched anything
    // outside the aria-hidden subtree.
    expect(announced()).toBe(duringStream)
    await act(async () => { finish(envelope({ onTopic: true, reply: 'final complete reply' })) })
    await screen.findByText('final complete reply')
    expect(announced()).not.toBe(duringStream)
    expect(announced()).toContain('final complete reply')
  })
})

describe('buddy drawer -- keyboard and focus (brief review line: I6)', () => {
  function renderButton() {
    const queryClient = makeQueryClient()
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>
        <SessionProvider initialState={{ user: { id: 'student' } as User, profile: { id: 'student', account_status: 'active' as const, restricted_until: null }, learnerState }}>{children}</SessionProvider>
      </QueryClientProvider>
    )
    return render(<BuddyButton />, { wrapper })
  }

  it('closes on Escape and returns focus to the header Buddy button', async () => {
    renderButton()
    const trigger = screen.getByRole('button', { name: 'Buddy' })
    // `fireEvent.click` does not simulate a real browser's focus-follows-click, so the trigger
    // is focused explicitly first -- the focus manager can only remember and restore what was
    // actually focused when the drawer opened.
    trigger.focus()
    fireEvent.click(trigger)
    await screen.findByRole('dialog')
    fireEvent.keyDown(document, { key: 'Escape' })
    // Focus restoration rides the popup's own close animation/fallback timer (Base UI's
    // `FloatingFocusManager`), so this can lag one tick behind the dialog leaving the DOM.
    await waitFor(() => expect(document.activeElement).toBe(trigger), { timeout: 3000 })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does not trap focus -- an element outside the drawer stays focusable while it is open', async () => {
    const queryClient = makeQueryClient()
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>
        <SessionProvider initialState={{ user: { id: 'student' } as User, profile: { id: 'student', account_status: 'active' as const, restricted_until: null }, learnerState }}>{children}</SessionProvider>
      </QueryClientProvider>
    )
    render(
      <>
        <button type="button">Outside control</button>
        <BuddyDrawer open={true} onOpenChange={vi.fn()} />
      </>,
      { wrapper },
    )
    await screen.findByRole('dialog')
    const outside = screen.getByRole('button', { name: 'Outside control' })
    outside.focus()
    expect(document.activeElement).toBe(outside)
  })
})
