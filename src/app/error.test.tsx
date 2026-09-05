import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import AppError from './error'

afterEach(cleanup)

it('re-fetches failed server content using the installed Next retry API', () => {
  const retry = vi.fn()
  render(<AppError error={new Error('private database detail')} retry={retry} />)
  expect(screen.queryByText('private database detail')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(retry).toHaveBeenCalledOnce()
})
