// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const db = vi.hoisted(() => ({ user: null as { id: string } | null }))

vi.mock('@/lib/supabase/server', () => ({
  getUserAndProfile: async () => ({ user: db.user, profile: null }),
}))

import { isAdmin, requireAdmin } from './gate'

const ORIGINAL_ADMIN_USER_IDS = process.env.ADMIN_USER_IDS

beforeEach(() => {
  db.user = null
})

afterEach(() => {
  if (ORIGINAL_ADMIN_USER_IDS === undefined) delete process.env.ADMIN_USER_IDS
  else process.env.ADMIN_USER_IDS = ORIGINAL_ADMIN_USER_IDS
})

describe('isAdmin', () => {
  it('denies everyone when the env is empty', () => {
    process.env.ADMIN_USER_IDS = ''
    expect(isAdmin('u1')).toBe(false)
    expect(isAdmin(undefined)).toBe(false)
    expect(isAdmin(null)).toBe(false)
  })

  it('denies everyone when the env is unset', () => {
    delete process.env.ADMIN_USER_IDS
    expect(isAdmin('u1')).toBe(false)
  })

  it('passes a listed id', () => {
    process.env.ADMIN_USER_IDS = 'u1,u2'
    expect(isAdmin('u1')).toBe(true)
    expect(isAdmin('u2')).toBe(true)
    expect(isAdmin('u3')).toBe(false)
  })

  it('tolerates whitespace around ids', () => {
    process.env.ADMIN_USER_IDS = ' u1 , u2 ,  u3  '
    expect(isAdmin('u1')).toBe(true)
    expect(isAdmin('u2')).toBe(true)
    expect(isAdmin('u3')).toBe(true)
    expect(isAdmin('u4')).toBe(false)
  })

  it('never matches an empty id even if a stray comma leaves an empty slot', () => {
    process.env.ADMIN_USER_IDS = 'u1,,u2'
    expect(isAdmin('')).toBe(false)
    expect(isAdmin(undefined)).toBe(false)
  })
})

describe('requireAdmin', () => {
  it('returns a 404 Response for a signed-out caller', async () => {
    process.env.ADMIN_USER_IDS = 'u1'
    db.user = null
    const result = await requireAdmin()
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(404)
  })

  it('returns a 404 Response for a signed-in non-admin', async () => {
    process.env.ADMIN_USER_IDS = 'u1'
    db.user = { id: 'u2' }
    const result = await requireAdmin()
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(404)
  })

  it('returns the user for a listed admin id', async () => {
    process.env.ADMIN_USER_IDS = 'u1'
    db.user = { id: 'u1' }
    const result = await requireAdmin()
    expect(result).not.toBeInstanceOf(Response)
    expect((result as { user: { id: string } }).user.id).toBe('u1')
  })
})
