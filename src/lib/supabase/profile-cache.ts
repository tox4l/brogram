import { createHmac, timingSafeEqual } from 'node:crypto'
import type { AccountStatus } from '@/lib/contracts'

/**
 * W2FIX-P: `updateSession` used to pay two serial Supabase round trips
 * (`rpc('lift_expired_restriction')` + a `profiles` select) on *every*
 * proxy-matched request, including pages that read nothing else from
 * Supabase (measured ~500ms course-tile-click cost, T3.2 report N2-1). This
 * cookie lets a request that already read the profile within the last
 * `PROFILE_CACHE_TTL_MS` skip both calls entirely.
 *
 * Signed with `SUPABASE_SERVICE_ROLE_KEY` via HMAC-SHA256 (`node:crypto`,
 * built into the Node.js runtime Proxy now defaults to in Next 16 -- no new
 * dependency). That key already exists only on the server and is never sent
 * to the browser, so reusing it as an HMAC secret leaks nothing: HMAC is
 * one-way, and HMAC-ing with it is not meaningfully different from minting a
 * second secret and keeping it exactly as private. The signature makes the
 * payload tamper-evident, not merely time-boxed by cookie `Max-Age`: the
 * issue time travels *inside* the signed body, so a captured cookie replayed
 * later cannot be freshened by resending it past its own TTL, and no field
 * (`account_status` included) can be flipped without invalidating the HMAC
 * -- there is no way to forge this cookie into a *less* restricted state
 * than the last real read produced.
 *
 * If `SUPABASE_SERVICE_ROLE_KEY` is not configured, encode/decode both
 * return `null` -- caching is skipped and every request re-reads Supabase
 * directly, exactly as `updateSession` behaved before this file existed.
 */

export const PROFILE_CACHE_COOKIE = 'bg-profile-cache'
export const PROFILE_CACHE_TTL_MS = 60_000

export interface CachedAccount {
  account_status: AccountStatus
  restricted_until: string | null
}

interface CachePayload extends CachedAccount {
  userId: string
  issuedAt: number
}

const ACCOUNT_STATUSES: readonly AccountStatus[] = ['active', 'warned', 'restricted', 'banned']

function signingKey(): string | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  return key && key.trim() ? key : null
}

function sign(body: string, key: string): string {
  return createHmac('sha256', key).update(body).digest('base64url')
}

/** Builds the cookie value, or `null` when no signing key is configured. */
export function encodeProfileCache(userId: string, account: CachedAccount, now = Date.now()): string | null {
  const key = signingKey()
  if (!key) return null
  const payload: CachePayload = {
    userId, issuedAt: now, account_status: account.account_status, restricted_until: account.restricted_until,
  }
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${body}.${sign(body, key)}`
}

/**
 * Verifies the signature, freshness (<= `PROFILE_CACHE_TTL_MS` old, and not
 * issued in the future) and that the cookie belongs to `userId` -- the
 * defence against a cookie surviving a sign-in by a *different* user on a
 * shared browser. Returns `null` on any failure, which the caller treats
 * exactly like a cache miss: a fresh Supabase read runs instead. Never
 * throws on malformed input.
 */
export function decodeProfileCache(cookieValue: string | undefined | null, userId: string, now = Date.now()): CachedAccount | null {
  if (!cookieValue) return null
  const key = signingKey()
  if (!key) return null
  const dot = cookieValue.indexOf('.')
  if (dot < 1) return null
  const body = cookieValue.slice(0, dot)
  const signature = cookieValue.slice(dot + 1)
  let expected: string
  try { expected = sign(body, key) } catch { return null }
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  let payload: CachePayload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (payload.userId !== userId) return null
  if (typeof payload.issuedAt !== 'number' || !Number.isFinite(payload.issuedAt)) return null
  if (now - payload.issuedAt > PROFILE_CACHE_TTL_MS || now < payload.issuedAt) return null
  if (!ACCOUNT_STATUSES.includes(payload.account_status)) return null
  return { account_status: payload.account_status, restricted_until: payload.restricted_until ?? null }
}
