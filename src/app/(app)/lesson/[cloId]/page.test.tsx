import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useParams: vi.fn(),
  lessonView: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useParams: mocks.useParams }))
vi.mock('@/components/lesson/LessonView', () => ({
  LessonView: (props: { cloId: string }) => {
    mocks.lessonView(props)
    return <p>lesson-view:{props.cloId}</p>
  },
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('/(app)/lesson/[cloId] page', () => {
  it('reads cloId from the route params and hands it straight to LessonView', async () => {
    mocks.useParams.mockReturnValue({ cloId: 'INFS1101-3' })
    const Page = (await import('./page')).default
    render(<Page />)

    expect(screen.getByText('lesson-view:INFS1101-3')).toBeTruthy()
    expect(mocks.lessonView).toHaveBeenCalledWith({ cloId: 'INFS1101-3' })
  })
})
