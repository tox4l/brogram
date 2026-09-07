// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { decodeProfileCache, encodeProfileCache, PROFILE_CACHE_TTL_MS } from './profile-cache'

const KEY = 'test-service-role-key-do-not-use'

describe('profile cache cookie', () => {
  beforeEach(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = KEY
  })

  afterEach(() => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
  })

  it('round-trips a freshly encoded value', () => {
    const encoded = encodeProfileCache('student', { account_status: 'active', restricted_until: null })
    expect(encoded).not.toBeNull()
    const decoded = decodeProfileCache(encoded, 'student')
    expect(decoded).toEqual({ account_status: 'active', restricted_until: null })
  })

  it('carries restricted_until through the round trip', () => {
    const encoded = encodeProfileCache('student', { account_status: 'restricted', restricted_until: '2099-01-01T00:00:00Z' })
    const decoded = decodeProfileCache(encoded, 'student')
    expect(decoded).toEqual({ account_status: 'restricted', restricted_until: '2099-01-01T00:00:00Z' })
  })

  it('rejects a cookie tampered to claim a less restricted status', () => {
    const encoded = encodeProfileCache('student', { account_status: 'banned', restricted_until: null })!
    const [, signature] = encoded.split('.')
    const forgedBody = Buffer.from(JSON.stringify({
      userId: 'student', issuedAt: Date.now(), account_status: 'active', restricted_until: null,
    }), 'utf8').toString('base64url')
    expect(decodeProfileCache(`${forgedBody}.${signature}`, 'student')).toBeNull()
  })

  it('rejects a cookie with a corrupted signature', () => {
    const encoded = encodeProfileCache('student', { account_status: 'active', restricted_until: null })!
    const [body, signature] = encoded.split('.')
    const flipped = signature.slice(0, -1) + (signature.at(-1) === 'a' ? 'b' : 'a')
    expect(decodeProfileCache(`${body}.${flipped}`, 'student')).toBeNull()
  })

  it('rejects a cookie issued to a different user', () => {
    const encoded = encodeProfileCache('student-a', { account_status: 'active', restricted_until: null })
    expect(decodeProfileCache(encoded, 'student-b')).toBeNull()
  })

  it('rejects a cookie older than the TTL', () => {
    const issuedAt = Date.now()
    const encoded = encodeProfileCache('student', { account_status: 'active', restricted_until: null }, issuedAt)
    expect(decodeProfileCache(encoded, 'student', issuedAt + PROFILE_CACHE_TTL_MS + 1)).toBeNull()
  })

  it('accepts a cookie right at the TTL boundary', () => {
    const issuedAt = Date.now()
    const encoded = encodeProfileCache('student', { account_status: 'active', restricted_until: null }, issuedAt)
    expect(decodeProfileCache(encoded, 'student', issuedAt + PROFILE_CACHE_TTL_MS)).not.toBeNull()
  })

  it('rejects a cookie issued in the future (clock-rollback replay)', () => {
    const issuedAt = Date.now()
    const encoded = encodeProfileCache('student', { account_status: 'active', restricted_until: null }, issuedAt)
    expect(decodeProfileCache(encoded, 'student', issuedAt - 1)).toBeNull()
  })

  it('rejects malformed cookie values without throwing', () => {
    expect(decodeProfileCache('not-a-valid-cookie', 'student')).toBeNull()
    expect(decodeProfileCache('', 'student')).toBeNull()
    expect(decodeProfileCache(undefined, 'student')).toBeNull()
    expect(decodeProfileCache('.', 'student')).toBeNull()
  })

  it('skips caching entirely when no service role key is configured', () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    const encoded = encodeProfileCache('student', { account_status: 'active', restricted_until: null })
    expect(encoded).toBeNull()
  })

  it('cannot be decoded once the signing key changes (key rotation invalidates the cache)', () => {
    const encoded = encodeProfileCache('student', { account_status: 'active', restricted_until: null })
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'a-different-key'
    expect(decodeProfileCache(encoded, 'student')).toBeNull()
  })
})
