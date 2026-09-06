import { afterEach, describe, expect, it } from 'vitest'
import { clearQueryClient, getQueryClient, makeQueryClient, resetQueryClientForUser } from './client'

afterEach(() => { clearQueryClient() })

describe('makeQueryClient', () => {
  it('pins the deliberate global defaults', () => {
    // `refetchOnWindowFocus: false` is the whole defence against an
    // exercise-screen refocus storm — the 15s idle-blur guard already reacts
    // to that gap, and a background refetch here would race it. A silent
    // regression here is easy to miss in review; pin it directly.
    const options = makeQueryClient().getDefaultOptions()
    expect(options.queries?.refetchOnWindowFocus).toBe(false)
    expect(options.queries?.retry).toBe(1)
    expect(options.queries?.throwOnError).toBe(false)
  })
})

describe('getQueryClient', () => {
  it('returns the same browser instance across calls', () => {
    expect(getQueryClient()).toBe(getQueryClient())
  })
})

describe('resetQueryClientForUser', () => {
  it('is a no-op the first time any user is seen', () => {
    const client = getQueryClient()
    client.setQueryData(['probe'], 'value')
    resetQueryClientForUser('student-a')
    expect(client.getQueryData(['probe'])).toBe('value')
  })

  it('is a no-op on a repeat render of the same user', () => {
    resetQueryClientForUser('student-a')
    const client = getQueryClient()
    client.setQueryData(['probe'], 'value')
    resetQueryClientForUser('student-a')
    expect(client.getQueryData(['probe'])).toBe('value')
  })

  it('clears the whole cache when the user id changes', () => {
    resetQueryClientForUser('student-a')
    const client = getQueryClient()
    client.setQueryData(['probe'], 'value')
    resetQueryClientForUser('student-b')
    expect(client.getQueryData(['probe'])).toBeUndefined()
  })
})

describe('clearQueryClient', () => {
  it('drops the browser singleton so the next call mints a fresh client', () => {
    const before = getQueryClient()
    before.setQueryData(['probe'], 'value')
    clearQueryClient()
    const after = getQueryClient()
    expect(after).not.toBe(before)
    expect(after.getQueryData(['probe'])).toBeUndefined()
  })
})
