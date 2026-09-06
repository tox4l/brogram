// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const db = vi.hoisted(() => ({ user: null as { id: string } | null }))

vi.mock('@/lib/supabase/server', () => ({
  getUserAndProfile: async () => ({ user: db.user, profile: null }),
}))

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
}))

import AdminGroupLayout from './layout'

const ORIGINAL_ADMIN_USER_IDS = process.env.ADMIN_USER_IDS

beforeEach(() => {
  process.env.ADMIN_USER_IDS = 'admin1'
  db.user = null
})

afterEach(() => {
  if (ORIGINAL_ADMIN_USER_IDS === undefined) delete process.env.ADMIN_USER_IDS
  else process.env.ADMIN_USER_IDS = ORIGINAL_ADMIN_USER_IDS
})

describe('(admin) group layout', () => {
  it('calls notFound() for a signed-out visitor', async () => {
    db.user = null
    await expect(AdminGroupLayout({ children: 'child' })).rejects.toThrow('NOT_FOUND')
  })

  it('calls notFound() for a signed-in non-admin', async () => {
    db.user = { id: 'not-admin' }
    await expect(AdminGroupLayout({ children: 'child' })).rejects.toThrow('NOT_FOUND')
  })

  it('renders children for a listed admin', async () => {
    db.user = { id: 'admin1' }
    await expect(AdminGroupLayout({ children: 'child' })).resolves.toBe('child')
  })
})
