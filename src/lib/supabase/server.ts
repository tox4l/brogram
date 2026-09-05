import 'server-only'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import type { AccountStatus } from '@/lib/contracts'

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value?.trim()) throw new Error(`Missing required variable ${name}`)
  return value
}

export async function getUserAndProfile(): Promise<{
  user: User | null
  profile: { id: string; account_status: AccountStatus; restricted_until: string | null } | null
}> {
  const store = await cookies()
  const supabase = createServerClient(
    requiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try {
            for (const c of list) store.set(c.name, c.value, c.options)
          } catch {
            // Server Components cannot write cookies; A2's proxy must refresh them.
          }
        },
      },
    },
  )
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { user: null, profile: null }
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, account_status, restricted_until')
    .eq('id', user.id)
    .maybeSingle()
  if (profileError) throw new Error('Unable to load Supabase profile', { cause: profileError })
  return { user, profile }
}

export function serviceClient(): SupabaseClient {
  return createClient(requiredEnv('NEXT_PUBLIC_SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}
