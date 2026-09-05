'use client'

import { createBrowserClient } from '@supabase/ssr'

// Keep public env reads literal so Next can inline them in the browser bundle.
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Sign-in is unavailable right now. Try again shortly.')
  return createBrowserClient(url, key)
}
