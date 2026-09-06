import type { PropsWithChildren } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { User } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEnvelope, AgentError, BuddyReply, LearnerState } from '@/lib/contracts'
import { SessionProvider } from '@/components/shell/SessionProvider'
import { BuddyDrawer } from './Drawer'
import { REFUSAL } from './state'

const spies = vi.hoisted(() => ({ stream: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/agents/client', () => ({ streamAgent: spies.stream }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: spies.from }) }))

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

function setup() {
  const initial = { user: { id: 'student' } as User, profile: { id: 'student', account_status: 'active' as const, restricted_until: null }, learnerState }
  const wrapper = ({ children }: PropsWithChildren) => <SessionProvider initialState={initial}>{children}</SessionProvider>
  return render(<BuddyDrawer open={true} onOpenChange={vi.fn()} />, { wrapper })
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
    const wrapper = ({ children }: PropsWithChildren) => <SessionProvider initialState={{ user: { id: 'student' } as User, profile: null, learnerState }}>{children}</SessionProvider>
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
})
