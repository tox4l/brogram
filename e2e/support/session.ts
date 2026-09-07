import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import type { BrowserContext } from '@playwright/test'

/**
 * The three env vars every spec needs: the public Supabase URL/anon key (for the SSR cookie dance
 * `mintSession` performs) and the service role key (for setup and teardown through the admin API).
 */
export interface E2eEnv {
  url: string
  anonKey: string
  serviceKey: string
}

export function readEnv(): Partial<E2eEnv> {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  }
}

export function hasEnv(env: Partial<E2eEnv>): env is E2eEnv {
  return Boolean(env.url && env.anonKey && env.serviceKey)
}

export function serviceClient(env: E2eEnv): SupabaseClient {
  return createClient(env.url, env.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

export interface MagicLink {
  user: { id: string }
  properties: { hashed_token: string }
}

/**
 * Mints a session the same way the real magic link would, without sending an email: `verifyOtp` against
 * the token `auth.admin.generateLink` minted, then copies the resulting cookies into the Playwright
 * browser context. The real end-to-end magic-link email is a manual check under C6, not exercised here.
 */
export async function mintSession(env: E2eEnv, context: BrowserContext, baseURL: string, link: MagicLink) {
  const cookies = new Map<string, { name: string; value: string; options: CookieOptions }>()
  const auth = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => [...cookies.values()].map(({ name, value }) => ({ name, value })),
      setAll: (values) => { for (const cookie of values) cookies.set(cookie.name, cookie) },
    },
  })
  const verified = await auth.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  if (verified.error) throw verified.error
  const origin = new URL(baseURL)
  await context.addCookies([...cookies.values()].map(({ name, value, options }) => ({
    name, value, domain: origin.hostname, path: options.path ?? '/',
    httpOnly: Boolean(options.httpOnly), secure: origin.protocol === 'https:',
    sameSite: options.sameSite === 'none' ? 'None' as const : options.sameSite === 'strict' ? 'Strict' as const : 'Lax' as const,
  })))
}

/**
 * Invites `email` (upserting on the unique email column, so a reused `.edu.qa` account keeps one row
 * across runs) and mints its auth user through the admin API — this creates the user on first use and
 * simply reuses it, and its invite, on every later run.
 */
export async function createOrReuseInvitedUser(service: SupabaseClient, email: string) {
  const invite = await service.from('invites').upsert({ code: randomUUID(), email }, { onConflict: 'email' }).select('code').single()
  if (invite.error) throw invite.error
  const link = await service.auth.admin.generateLink({ type: 'magiclink', email })
  if (link.error) throw link.error
  return { userId: link.data.user.id, inviteCode: invite.data.code as string, link: link.data as MagicLink }
}

/**
 * Clears everything a prior run of the shared-account specs may have left behind, so the reused
 * `.edu.qa` test account always starts a spec from a blank learner state.
 *
 * `profiles.account_status` is reset too (T3.3): the integrity trigger (`supabase/migrations/
 * 0003_integrity.sql`/`0004_admin_users.sql`) writes `warned`/`restricted`/`banned` onto this
 * column as a side effect of an `integrity_events` insert, and never writes it back down on its
 * own -- deleting the events above does not undo it. `blur-overlay.spec.ts`'s three PrintScreen
 * presses (weight 3 each) plus its one blur event cross the 10-point `warned` threshold on this
 * shared account by design (proving the escalation is real), so without this the very next spec
 * to reuse the account would open under a stale `AccountNotice` banner that has nothing to do
 * with anything it did itself.
 */
export async function resetLearnerData(service: SupabaseClient, userId: string) {
  for (const table of ['learner_state', 'attempts', 'integrity_events'] as const) {
    const { error } = await service.from(table).delete().eq('user_id', userId)
    if (error) throw error
  }
  const profile = await service.from('profiles').update({ account_status: 'active', restricted_until: null }).eq('id', userId)
  if (profile.error) throw profile.error
}

/** Full teardown for a one-off test account (fail-fix-pass mints a fresh `.edu.qa` email per run). */
export async function deleteInvitedUser(service: SupabaseClient, userId: string, inviteCode: string) {
  const deletedInvite = await service.from('invites').delete().eq('code', inviteCode)
  if (deletedInvite.error) throw deletedInvite.error
  const deleted = await service.auth.admin.deleteUser(userId)
  if (deleted.error) throw deleted.error
}
