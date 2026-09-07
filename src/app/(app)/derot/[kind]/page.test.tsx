import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LegacyDerotKindRedirect from './page'

const mocks = vi.hoisted(() => ({ replace: vi.fn(), params: vi.fn(), searchParams: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useParams: () => mocks.params(),
  useSearchParams: () => mocks.searchParams(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.searchParams.mockReturnValue(new URLSearchParams())
})
afterEach(cleanup)

describe('the old /derot/[kind] path', () => {
  it('still resolves -- an Arcade kind forwards to /derot/arcade/[kind]', () => {
    mocks.params.mockReturnValue({ kind: 'trace' })
    render(<LegacyDerotKindRedirect />)
    expect(mocks.replace).toHaveBeenCalledWith('/derot/arcade/trace')
  })

  it('a Playground kind forwards to /derot/play/[kind]', () => {
    mocks.params.mockReturnValue({ kind: 'breathe' })
    render(<LegacyDerotKindRedirect />)
    expect(mocks.replace).toHaveBeenCalledWith('/derot/play/breathe')
  })

  it('preserves the query string, e.g. the buddy suggestion chip deep link', () => {
    mocks.params.mockReturnValue({ kind: 'trace' })
    mocks.searchParams.mockReturnValue(new URLSearchParams('item=d3'))
    render(<LegacyDerotKindRedirect />)
    expect(mocks.replace).toHaveBeenCalledWith('/derot/arcade/trace?item=d3')
  })

  it('sends an unknown kind back to the hub instead of a dead link', () => {
    mocks.params.mockReturnValue({ kind: 'made-up' })
    render(<LegacyDerotKindRedirect />)
    expect(mocks.replace).toHaveBeenCalledWith('/derot')
  })
})
