'use client'

import { Suspense, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BannedAccount } from '@/components/shell/AccountNotice'
import { createClient } from '@/lib/supabase/client'

const linkErrors: Record<string, string> = {
  'invalid-link': 'This sign-in link has expired or is invalid. Request a new one below.',
  'state-unavailable': 'Your link was verified, but your learning profile could not be loaded. Try opening your dashboard again.',
  'sign-in-unavailable': 'Sign-in is unavailable right now. Try again shortly.',
  'account-unavailable': 'Your account could not be checked. Try again shortly.',
  configuration: 'Sign-in is unavailable right now. Try again shortly.',
}

function LoginForm() {
  const params = useSearchParams()
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

  if (params.get('reason') === 'banned') return <BannedAccount />
  const linkError = linkErrors[params.get('error') ?? '']
  return (
    <>
      <h1 className="max-w-xl text-4xl font-medium tracking-tight sm:text-5xl">A little practice.<br /><span className="text-emerald-300">A lot of progress.</span></h1>
      <p className="mt-5 max-w-sm text-base leading-relaxed text-muted-foreground">Sign in to your coding space. We’ll email you a link.</p>
      <form onSubmit={submit} className="mt-9 space-y-5">
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium">Email</label>
          <Input id="email" type="email" autoComplete="email" required value={email} disabled={sending}
            onChange={(event) => { setEmail(event.target.value); setSent(false) }}
            aria-describedby="email-help" className="h-12 text-base" />
          <p id="email-help" className="text-xs leading-relaxed text-muted-foreground">Use your .edu.qa email. Beta access is by invitation.</p>
        </div>
        {error ? <p role="alert" className="whitespace-pre-wrap text-sm text-foreground">{error}</p> : linkError && !sent ? <p role="alert" className="text-sm text-muted-foreground">{linkError}</p> : null}
        {sent && <p role="status" className="text-sm leading-relaxed text-emerald-300">Check your email for a sign-in link. You can close this tab once it arrives.</p>}
        <Button type="submit" disabled={sending} className="h-12 w-full bg-emerald-300 text-primary-foreground hover:bg-emerald-200">
          {sending ? 'Sending link…' : 'Send magic link'}
        </Button>
      </form>
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
