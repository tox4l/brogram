'use client'

import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// Excludes visually ambiguous characters (0/O, 1/l/I, and i/o alongside l) so a
// handed-over password is easy to read aloud and retype without mistakes.
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
const PASSWORD_LENGTH = 12
const MIN_PASSWORD_LENGTH = 8

function generatePassword(): string {
  const bytes = new Uint32Array(PASSWORD_LENGTH)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (n) => PASSWORD_ALPHABET[n % PASSWORD_ALPHABET.length]).join('')
}

interface CreatedAccount {
  email: string
  password: string
}

interface CreateAccountFormProps {
  onCreated?: () => void | Promise<void>
}

export function CreateAccountForm({ onCreated }: CreateAccountFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreatedAccount | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail.includes('@')) {
      setError('Enter a valid email address')
      return
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
      return
    }
    setError(null)
    setCreated(null)
    setBusy(true)
    try {
      const res = await fetch('/api/admin/users/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, password, displayName: displayName.trim() }),
      })
      const body = (await res.json().catch(() => null)) as { ok: true; email: string } | { ok: false; error: string } | null
      if (!res.ok || !body || body.ok === false) {
        throw new Error((body as { error?: string } | null)?.error ?? `Request failed (${res.status})`)
      }
      setCreated({ email: body.email, password })
      setEmail('')
      setPassword('')
      setDisplayName('')
      await onCreated?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create account')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={handleSubmit} noValidate className="flex flex-wrap items-start gap-2">
        <Input
          type="email"
          value={email}
          onChange={(event) => { setEmail(event.target.value); if (error) setError(null) }}
          placeholder="learner@university.edu"
          disabled={busy}
          aria-label="Account email"
          className="w-64"
        />
        <div className="flex items-center gap-1">
          <Input
            type="text"
            value={password}
            onChange={(event) => { setPassword(event.target.value); if (error) setError(null) }}
            placeholder="Temporary password"
            disabled={busy}
            aria-label="Temporary password"
            autoComplete="off"
            spellCheck={false}
            className="w-44"
          />
          <Button type="button" variant="outline" disabled={busy} onClick={() => setPassword(generatePassword())}>
            Generate
          </Button>
        </div>
        <Input
          type="text"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="Display name (optional)"
          disabled={busy}
          aria-label="Display name"
          className="w-48"
        />
        <Button type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </Button>
      </form>
      {error && <p className="text-small text-destructive">{error}</p>}
      {created && (
        <div role="status" className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
          <div className="space-y-1 text-body">
            <p>
              Account created for {created.email}. Temporary password: <span className="font-mono">{created.password}</span> — hand this to the learner now, it will not be shown again.
            </p>
            <p className="text-muted-foreground">Ask them to change this password on their Account page after the first sign-in.</p>
          </div>
          <button
            type="button"
            onClick={() => setCreated(null)}
            className="shrink-0 text-micro text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}
