'use client'

import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const INVITE_DOMAIN_SUFFIX = '.edu.qa'
const INVALID_DOMAIN_MESSAGE = `Invite emails must end with ${INVITE_DOMAIN_SUFFIX}`

interface MintInviteFormProps {
  onMint: (email: string) => Promise<void> | void
  busy?: boolean
}

export function MintInviteForm({ onMint, busy = false }: MintInviteFormProps) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalized = value.trim().toLowerCase()
    if (!normalized.includes('@') || !normalized.endsWith(INVITE_DOMAIN_SUFFIX)) {
      setError(INVALID_DOMAIN_MESSAGE)
      return
    }
    setError(null)
    void onMint(normalized)
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex items-start gap-2">
      <div className="flex flex-col gap-1">
        <Input
          type="email"
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            if (error) setError(null)
          }}
          placeholder="student@university.edu.qa"
          disabled={busy}
          aria-label="Invite email"
          aria-invalid={error ? true : undefined}
          className="w-72"
        />
        {error && <p className="text-small text-destructive">{error}</p>}
      </div>
      <Button type="submit" disabled={busy}>
        {busy ? 'Minting...' : 'Mint invite'}
      </Button>
    </form>
  )
}
