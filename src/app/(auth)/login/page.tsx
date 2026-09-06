'use client'

import { Suspense, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BannedAccount } from '@/components/shell/AccountNotice'
import { createClient } from '@/lib/supabase/client'

// Magic links wait for a custom SMTP sender; keep the flow in this file, gated, so
// flipping the flag is the only step needed once a mailer exists.
const MAGIC_LINK_ENABLED = process.env.NEXT_PUBLIC_AUTH_MAGIC_LINK === 'true'

const linkErrors: Record<string, string> = {
  'invalid-link': 'This sign-in link has expired or is invalid. Sign in with your password, or ask Velocity for a new account.',
  'state-unavailable': 'Your link was verified, but your learning profile could not be loaded. Try opening your dashboard again.',
  'sign-in-unavailable': 'Sign-in is unavailable right now. Try again shortly.',
  'account-unavailable': 'Your account could not be checked. Try again shortly.',
  configuration: 'Sign-in is unavailable right now. Try again shortly.',
}

type SupabaseClient = ReturnType<typeof createClient>

/**
 * Mirrors the routing rule in src/app/auth/confirm/route.ts so both sign-in paths agree.
 * A failed read must never be treated as "no learner_state yet" — that would send an
 * existing, onboarded learner back through onboarding. Fall back to the dashboard instead.
 */
async function destinationAfterSignIn(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data: learner, error } = await supabase
    .from('learner_state')
    .select('state')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) return '/dashboard'
  const state = learner as { state?: { profile?: { onboardingComplete?: boolean } } } | null
  return state?.state?.profile?.onboardingComplete === true ? '/dashboard' : '/onboarding'
}

function PasswordLoginForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError(null)

    const supabase = createClient()
    let userId: string
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (authError || !data.user) {
        setError(authError?.message ?? 'Invalid login credentials')
        setSubmitting(false)
        return
      }
      userId = data.user.id
    } catch {
      setError('We could not sign you in. Try again shortly.')
      setSubmitting(false)
      return
    }

    // The user is authenticated at this point. A failure below — reading their
    // learner_state, or the navigation itself — must never be reported as a failed
    // sign-in; fall back to the dashboard instead of leaving them stuck on this form.
    try {
      const destination = await destinationAfterSignIn(supabase, userId)
      // signInWithPassword persists the session to cookies before resolving, so a client-side
      // navigation already carries them; no full page load is required.
      router.replace(destination)
    } catch {
      router.replace('/dashboard')
    }
  }

  return (
    <form onSubmit={submit} className="mt-9 space-y-5">
      <div className="space-y-2">
        <label htmlFor="email" className="text-sm font-medium">Email</label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          disabled={submitting}
          onChange={(event) => setEmail(event.target.value)}
          className="h-12 text-base"
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="password" className="text-sm font-medium">Password</label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          disabled={submitting}
          onChange={(event) => setPassword(event.target.value)}
          className="h-12 text-base"
        />
      </div>
      {error && <p role="alert" className="whitespace-pre-wrap text-sm text-foreground">{error}</p>}
      <Button type="submit" disabled={submitting} className="h-12 w-full bg-emerald-300 text-primary-foreground hover:bg-emerald-200">
        {submitting ? 'Signing in…' : 'Sign in'}
      </Button>
      <p className="text-xs leading-relaxed text-muted-foreground">Accounts are issued by Velocity. Ask for yours.</p>
    </form>
  )
}

function MagicLinkForm() {
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending) return
    setSending(true); setError(null); setSent(false)
    try {
      const { error: authError } = await createClient().auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}/auth/confirm`, shouldCreateUser: true },
      })
      if (authError) setError(authError.message)
      else setSent(true)
    } catch {
      setError('We could not send your link. Try again shortly.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="mt-8 border-t border-border pt-8">
      <h2 className="text-sm font-medium">Or sign in with a magic link</h2>
      <form onSubmit={submit} className="mt-4 space-y-4">
        <div className="space-y-2">
          <label htmlFor="magic-link-email" className="text-sm font-medium">Email</label>
          <Input
            id="magic-link-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            disabled={sending}
            onChange={(event) => { setEmail(event.target.value); setSent(false) }}
            aria-describedby="magic-link-email-help"
            className="h-12 text-base"
          />
          <p id="magic-link-email-help" className="text-xs leading-relaxed text-muted-foreground">Use your .edu.qa email. Beta access is by invitation.</p>
        </div>
        {error && <p role="alert" className="whitespace-pre-wrap text-sm text-foreground">{error}</p>}
        {sent && <p role="status" className="text-sm leading-relaxed text-emerald-300">Check your email for a sign-in link. You can close this tab once it arrives.</p>}
        <Button type="submit" disabled={sending} variant="outline" className="h-12 w-full">
          {sending ? 'Sending link…' : 'Send magic link'}
        </Button>
      </form>
    </div>
  )
}

function LoginForm() {
  const params = useSearchParams()

  if (params.get('reason') === 'banned') return <BannedAccount />
  const linkError = linkErrors[params.get('error') ?? '']

  return (
    <>
      <h1 className="max-w-xl text-4xl font-medium tracking-tight sm:text-5xl">A little practice.<br /><span className="text-emerald-300">A lot of progress.</span></h1>
      <p className="mt-5 max-w-sm text-base leading-relaxed text-muted-foreground">Sign in to your coding space.</p>
      {linkError && <p role="alert" className="mt-4 text-sm text-muted-foreground">{linkError}</p>}
      <PasswordLoginForm />
      {MAGIC_LINK_ENABLED && <MagicLinkForm />}
      {params.get('error') === 'state-unavailable' && <Link className="mt-4 inline-block text-sm underline underline-offset-4" href="/dashboard">Open dashboard</Link>}
    </>
  )
}

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-8 sm:px-10">
      <Link href="/" className="w-fit text-xl font-semibold tracking-tight">BroGram<span className="text-emerald-300">.</span></Link>
      <div className="mx-auto my-auto w-full max-w-md py-16">
        <Suspense fallback={<p className="text-muted-foreground">Your coding space is ready. Preparing sign-in…</p>}><LoginForm /></Suspense>
      </div>
    </main>
  )
}
