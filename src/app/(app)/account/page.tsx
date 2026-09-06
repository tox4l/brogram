'use client'

import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createClient } from '@/lib/supabase/client'
import { useSession } from '@/store/session'

const MIN_PASSWORD_LENGTH = 8

export default function AccountPage() {
  const { user } = useSession()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    setError(null)
    setSuccess(false)

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setSubmitting(true)
    try {
      const { error: updateError } = await createClient().auth.updateUser({ password })
      if (updateError) {
        setError(updateError.message)
        return
      }
      setSuccess(true)
      setPassword('')
      setConfirmPassword('')
    } catch {
      setError('We could not change your password. Try again shortly.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-md space-y-7">
      <div>
        <h1 className="text-2xl font-medium tracking-tight">Your account</h1>
        <p className="mt-2 text-sm text-muted-foreground">{user?.email ?? 'Your account email is unavailable.'}</p>
      </div>

      <form onSubmit={submit} className="space-y-5">
        <div className="space-y-2">
          <label htmlFor="new-password" className="text-sm font-medium">New password</label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            disabled={submitting}
            onChange={(event) => { setPassword(event.target.value); setError(null); setSuccess(false) }}
            className="h-12 text-base"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="confirm-password" className="text-sm font-medium">Confirm new password</label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            required
            value={confirmPassword}
            disabled={submitting}
            onChange={(event) => { setConfirmPassword(event.target.value); setError(null); setSuccess(false) }}
            className="h-12 text-base"
          />
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">Use at least {MIN_PASSWORD_LENGTH} characters.</p>
        {error && <p role="alert" className="text-sm text-foreground">{error}</p>}
        {success && <p role="status" className="text-sm leading-relaxed text-emerald-300">Your password has been changed.</p>}
        <Button type="submit" disabled={submitting} className="h-12 w-full bg-emerald-300 text-primary-foreground hover:bg-emerald-200">
          {submitting ? 'Changing password…' : 'Change password'}
        </Button>
      </form>
    </div>
  )
}
