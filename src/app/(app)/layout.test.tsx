import { beforeEach, describe, expect, it, vi } from 'vitest'
import { compileLearnerState } from '@/lib/learner/compile'
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), query: vi.fn(), from: vi.fn(), headers: new Headers() }))
vi.mock('next/headers', () => ({ headers: async () => mocks.headers }))
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`) } }))
vi.mock('@/lib/supabase/server', () => ({
  serverClient: async () => ({ auth: { getUser: mocks.getUser }, from: mocks.from, rpc: async () => ({ error: null }) }),
  getUserAndProfile: async () => ({ user: (await mocks.getUser()).data.user, profile: { id: 'student', account_status: 'active', restricted_until: null } }),
}))
beforeEach(() => {
  vi.resetAllMocks()
  mocks.headers = new Headers({ 'x-brogram-pathname': '/dashboard', 'x-brogram-account-status': 'active', 'x-brogram-restricted-until': '' })
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'student' } }, error: null })
  mocks.query.mockImplementation((table) => ({ data: table === 'attempts' ? [] : null, error: null }))
  mocks.from.mockImplementation((table) => {
    let offset = 0
    const query = { select: () => query, eq: () => query, order: () => query, range: (from: number) => { offset = from; return query }, maybeSingle: () => mocks.query(table), then: (resolve: (v: unknown) => void) => Promise.resolve(mocks.query(table, offset)).then(resolve) }
    return query
  })
})
async function layout() {
  const { default: Layout } = await import('./layout')
  return Layout({ children: <p>Protected child</p> })
}
describe('app hydration', () => {
  it('uses the forwarded account without selecting profiles again', async () => {
    const tree = await layout()
    expect(tree.props.initialState.profile.account_status).toBe('active')
    expect(mocks.from.mock.calls.map(([table]) => table)).not.toContain('profiles')
  })
  it('redirects a missing identity to login', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })
    await expect(layout()).rejects.toThrow('REDIRECT:/login')
  })
  it.each([['banned', '/dashboard', '/auth/signout'], ['restricted', '/exercise/one', '/dashboard']])('gates %s accounts', async (status, path, destination) => {
    mocks.headers.set('x-brogram-account-status', status)
    mocks.headers.set('x-brogram-pathname', path)
    await expect(layout()).rejects.toThrow(`REDIRECT:${destination}`)
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('fails closed when account headers are missing', async () => {
    mocks.headers.delete('x-brogram-account-status')
    await expect(layout()).rejects.toThrow('Unable to load your profile')
  })
  it.each([{}, { profile: {} }, 'broken', { profile: {}, streak: {} }])('falls back for an incomplete persisted document: %j', async (state) => {
    mocks.query.mockReturnValue({ data: { state, version: 4 }, error: null })
    const tree = await layout()
    expect(tree.props.initialState.learnerState.profile.onboardingComplete).toBe(false)
    expect(tree.props.initialState.learnerState.streak.exerciseDays).toBe(0)
    expect(tree.props.initialState.learnerState.version).toBe(4)
  })
  it('expires saved streaks with the server clock and keeps dates and aggregates', async () => {
    const saved = compileLearnerState({ id: 'student' }, [], [], [], null)
    saved.streak = { exerciseDays: 8, derotDays: 4, lastExerciseDate: '2020-01-08', lastDerotDate: '2020-01-04' }
    saved.points = 3210
    mocks.query.mockImplementation((table) => ({ data: table === 'learner_state' ? { state: saved, version: 9 } : table === 'attempts' ? [] : null, error: null }))
    const tree = await layout()
    expect(tree.props.initialState.learnerState.streak).toEqual({ exerciseDays: 0, derotDays: 0, lastExerciseDate: '2020-01-08', lastDerotDate: '2020-01-04' })
    expect(tree.props.initialState.learnerState.points).toBe(3210)
    expect(tree.props.initialState.learnerState.version).toBe(9)
  })
  it('keeps a persisted Planner focus line through hydration', async () => {
    // `focus` is not part of the frozen LearnerState contract; it rides along as an extra
    // jsonb key that onboarding and useExerciseLoop write. Hydration spreads `row.state`
    // into the compiled state, so this extra key must survive untouched.
    const saved = { ...compileLearnerState({ id: 'student' }, [], [], [], null), focus: 'Work on loops next.' }
    mocks.query.mockImplementation((table) => ({ data: table === 'learner_state' ? { state: saved, version: 3 } : table === 'attempts' ? [] : null, error: null }))
    const tree = await layout()
    expect((tree.props.initialState.learnerState as typeof saved).focus).toBe('Work on loops next.')
  })
  it('recomputes a current streak from actual activity dates', async () => {
    const saved = compileLearnerState({ id: 'student' }, [], [], [], null)
    const today = new Date().toISOString()
    const yesterday = new Date(Date.now() - 86_400_000).toISOString()
    mocks.query.mockImplementation((table) => ({ data: table === 'learner_state' ? { state: saved, version: 2 } : table === 'attempts' ? [{ created_at: today }, { created_at: yesterday }] : null, error: null }))
    const tree = await layout()
    expect(tree.props.initialState.learnerState.streak.exerciseDays).toBe(2)
  })
  it('reads beyond the first history page when compiling a streak', async () => {
    const saved = compileLearnerState({ id: 'student' }, [], [], [], null)
    const today = new Date().toISOString()
    const yesterday = new Date(Date.now() - 86_400_000).toISOString()
    mocks.query.mockImplementation((table, offset = 0) => ({ data: table === 'learner_state' ? { state: saved, version: 2 } : table === 'attempts' ? offset === 0 ? Array.from({ length: 1000 }, () => ({ created_at: today })) : [{ created_at: yesterday }] : null, error: null }))
    const tree = await layout()
    expect(tree.props.initialState.learnerState.streak.exerciseDays).toBe(2)
    expect(mocks.query).toHaveBeenCalledWith('attempts', 1000)
  })
})
