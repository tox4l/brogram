import type { PropsWithChildren } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import type { User } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEnvelope, AgentError, BuddyReply, LearnerState } from '@/lib/contracts'
import { makeQueryClient } from '@/lib/query/client'
import { line } from '@/lib/voice/lines'
import { SessionProvider } from '@/components/shell/SessionProvider'
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
    await screen.findByText('Ask about the code you are stuck on, or why a pattern keeps failing.')
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
    expect(spies.from).toHaveBeenCalledTimes(1)
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

  it('paints a cached conversation with no fetch before first paint on a reopened drawer', () => {
    const client = makeQueryClient()
    const cached: BuddyMessage[] = [{ id: 'cached-1', role: 'assistant', content: 'cached reply from a prior open', createdAt: '2026-09-05T00:00:00.000Z' }]
    client.setQueryData(buddyMessagesKey('student'), cached)
    setup(vi.fn(), { queryClient: client })
    expect(screen.getByText('cached reply from a prior open')).toBeTruthy()
    expect(spies.from).not.toHaveBeenCalled()
  })

  it('frames a hard-failure derot suggestion as a Playground card linking straight at the runner', async () => {
    const hardFailureState: LearnerState = {
      ...learnerState,
      recentMistakes: Array.from({ length: 3 }, (_, i) => ({ exerciseId: `e${i}`, cloId: 'INFS1101-1' as const, pattern: 'scan' as const, label: 'off-by-one in range', at: '2026-09-05T00:00:00.000Z' })),
    }
    spies.stream.mockResolvedValue(envelope({ onTopic: true, reply: 'Rough one.', suggestion: { kind: 'derot', ref: 'trace' } }))
    setup(vi.fn(), { learnerState: hardFailureState })
    await typeAndSend('i keep failing this one')
    const link = await screen.findByRole('link')
    expect(link.getAttribute('href')).toBe('/derot/play/breathe')
    expect(link.textContent).toBe(line('buddy.suggest.play'))
  })

  it('frames a long-idle-gap derot suggestion as an Arcade card, keeping the existing deep-link redirect', async () => {
    const idleGapState: LearnerState = { ...learnerState, recentMistakes: [], updatedAt: '2000-01-01T00:00:00.000Z' }
    spies.stream.mockResolvedValue(envelope({ onTopic: true, reply: 'Been a while.', suggestion: { kind: 'derot', ref: 'trace' } }))
    setup(vi.fn(), { learnerState: idleGapState })
    await typeAndSend('what should i do next')
    const link = await screen.findByRole('link')
    expect(link.getAttribute('href')).toBe('/derot?drill=trace')
    expect(link.textContent).toBe(line('buddy.suggest.arcade'))
  })
})
