'use client'

import { Suspense, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BannedAccount } from '@/components/shell/AccountNotice'
import { createClient } from '@/lib/supabase/client'
import { ShaderSurface } from '@/components/visual/ShaderSurface'
import { Reveal } from '@/components/motion/Reveal'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'

// Magic links wait for a custom SMTP sender; keep the flow in this file, gated, so
// flipping the flag is the only step needed once a mailer exists.
const MAGIC_LINK_ENABLED = process.env.NEXT_PUBLIC_AUTH_MAGIC_LINK === 'true'

const linkErrors: Record<string, string> = {
  'invalid-link': 'This sign-in link has expired or is invalid. Sign in with your password, or ask Velocity for a new account.',
  'state-unavailable': 'The link checked out, but your learning profile could not be loaded. Try opening your dashboard again.',
  'sign-in-unavailable': 'Sign-in is unavailable right now. Try again shortly.',
  'account-unavailable': 'This account could not be checked. Try again shortly.',
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

const FIELD_LABEL_CLASS = 'text-micro uppercase tracking-[0.06em] text-muted-foreground'

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
    <form onSubmit={submit} className="space-y-6">
      <div className="space-y-2">
        <label htmlFor="email" className={FIELD_LABEL_CLASS}>Email</label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          disabled={submitting}
          onChange={(event) => setEmail(event.target.value)}
          className="h-12 text-body"
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="password" className={FIELD_LABEL_CLASS}>Password</label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          disabled={submitting}
          onChange={(event) => setPassword(event.target.value)}
          className="h-12 text-body"
        />
      </div>
      {error && <p role="alert" className="whitespace-pre-wrap text-small text-foreground">{error}</p>}
      <div className="space-y-4 border-t border-rule pt-6">
        <Button type="submit" disabled={submitting} className="h-12 w-full">
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
        <p className="text-micro text-muted-foreground">Accounts are issued by Velocity. Ask for yours.</p>
      </div>
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
    <div className="mt-8 border-t border-rule pt-8">
      <h2 className="text-h4 text-foreground">Or sign in with a magic link</h2>
      <form onSubmit={submit} className="mt-4 space-y-4">
        <div className="space-y-2">
          <label htmlFor="magic-link-email" className={FIELD_LABEL_CLASS}>Email</label>
          <Input
            id="magic-link-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            disabled={sending}
            onChange={(event) => { setEmail(event.target.value); setSent(false) }}
            aria-describedby="magic-link-email-help"
            className="h-12 text-body"
          />
          <p id="magic-link-email-help" className="text-micro text-muted-foreground">Use your .edu.qa email. Beta access is by invitation.</p>
        </div>
        {error && <p role="alert" className="whitespace-pre-wrap text-small text-foreground">{error}</p>}
        {sent && <p role="status" className="text-small text-success">Check your email for a sign-in link. You can close this tab once it arrives.</p>}
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
      {linkError && <p role="alert" className="mb-6 text-small text-muted-foreground">{linkError}</p>}
      <PasswordLoginForm />
      {MAGIC_LINK_ENABLED && <MagicLinkForm />}
      {params.get('error') === 'state-unavailable' && (
        <Link className="mt-4 inline-block text-small font-medium underline underline-offset-4" href="/dashboard">Open dashboard</Link>
      )}
    </>
  )
}

/**
 * W4 §9: "the full statement and the only screen that is nearly all stage."
 * One `--measure-form` column, one wordmark on a masked-line reveal, one
 * filled button. `<ShaderSurface>` paints the CSS floor everywhere and the
 * settle-and-freeze field behind this same card in Eclipse; the card itself
 * is the required >= 0.92 alpha scrim (spec §6.2 rule 6 — no control ever
 * sits directly over live shader pixels), so every string on this screen,
 * wordmark included, lives inside it rather than loose on the stage.
 */
export default function LoginPage() {
  const reducedMotion = useReducedMotion()

  return (
    <main className="relative flex w-full flex-1 items-center justify-center overflow-hidden px-6 py-16">
      <ShaderSurface motionPref="system" className="z-0" />
      <div className="relative z-10 w-full max-w-[34rem] rounded-2xl border border-rule bg-card/95 p-8 shadow-xs">
        <h1 className="font-display text-hero text-foreground">
          <Reveal mode="lines" reduced={reducedMotion}>BroGram.</Reveal>
        </h1>
        <p className="mt-3 text-lede text-muted-foreground">Sign in to your coding space.</p>
        <div className="mt-8">
          <Suspense fallback={<p className="text-small text-muted-foreground">The coding space is ready. Preparing sign-in…</p>}>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </main>
  )
}
