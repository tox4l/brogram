'use client'

import { useState, type FormEvent, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createClient } from '@/lib/supabase/client'
import { useSession } from '@/store/session'
import { useLearnerState, useWellness } from '@/lib/query/hooks'
import { useDockPrefsMutation } from '@/components/wellness/useDockPrefs'
import { resolveWellnessPrefs } from '@/lib/wellness/prefs'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'
import { THEMES } from '@/lib/theme/themes'
import { IntegrityPanel } from '@/components/account/IntegrityPanel'
import { cn } from '@/lib/utils'
import type { DockPlacement, LearnerProfile, MotionPreference, ThemeName, Tone, Verbosity } from '@/lib/contracts'
import { useWellnessPrefsMutation } from './prefsMutation'
import { useProfileMutation } from './profileMutation'
import { useDiagnostics, type DiagnosticMetric } from './diagnostics'

const MIN_PASSWORD_LENGTH = 8

const THEME_IDS = THEMES.map((entry) => entry.id)
function isThemeName(value: string | undefined): value is ThemeName {
  return (THEME_IDS as string[]).includes(value ?? '')
}

const DOCK_PLACEMENTS: { value: DockPlacement; label: string }[] = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'top', label: 'Top' },
  { value: 'float', label: 'Floating' },
  { value: 'hidden', label: 'Hidden' },
]

const MOTION_OPTIONS: { value: MotionPreference; label: string }[] = [
  { value: 'system', label: 'Match device' },
  { value: 'full', label: 'Full motion' },
  { value: 'reduced', label: 'Reduced' },
]

const TONE_OPTIONS: { value: Tone; label: string }[] = [
  { value: 'playful', label: 'Playful' },
  { value: 'supportive', label: 'Supportive' },
  { value: 'tough-love', label: 'Tough love' },
  { value: 'direct', label: 'Direct' },
]

const VERBOSITY_OPTIONS: { value: Verbosity; label: string }[] = [
  { value: 'short', label: 'Short' },
  { value: 'verbose', label: 'Detailed' },
]

type Depth = LearnerProfile['motivation']['depth']

const DEPTH_OPTIONS: { value: Depth; label: string }[] = [
  { value: 'pass', label: 'Just pass' },
  { value: 'understand', label: 'Understand it' },
  { value: 'master', label: 'Master it' },
]

const DIAGNOSTIC_LABEL: Record<DiagnosticMetric, string> = {
  LCP: 'Largest paint',
  CLS: 'Layout shift',
  INP: 'Interaction delay',
  TTFB: 'Time to first byte',
}

function formatDiagnosticValue(metric: DiagnosticMetric, value: number): string {
  return metric === 'CLS' ? value.toFixed(3) : `${value} ms`
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-5 rounded-xl border border-border p-5">
      <h2 id={id} className="text-base font-medium text-foreground">{title}</h2>
      {children}
    </section>
  )
}

function RadioPills<T extends string>({ label, options, value, onChange }: {
  label: string
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (next: T) => void
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
        {options.map((option) => {
          const checked = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => onChange(option.value)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-emerald-300',
                checked ? 'border-emerald-300 bg-emerald-300/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function SettingToggle({ id, label, checked, onChange, reducedMotion }: {
  id: string
  label: string
  checked: boolean
  onChange: (next: boolean) => void
  reducedMotion: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="text-sm text-foreground">{label}</label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn('relative h-6 w-11 shrink-0 rounded-full border border-transparent outline-none focus-visible:ring-2 focus-visible:ring-emerald-300', checked ? 'bg-emerald-300' : 'bg-muted')}
      >
        {/* Spec 10.11: "toggles animate their own knob and nothing else." */}
        <span
          className={cn(
            'block size-5 rounded-full bg-background shadow',
            !reducedMotion && 'transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  )
}

export default function AccountPage() {
  const { user } = useSession()
  const userId = user?.id ?? null
  const { setTheme, theme } = useTheme()

  const wellnessQuery = useWellness()
  const prefs = resolveWellnessPrefs(wellnessQuery.data?.prefs)
  const reducedMotion = useReducedMotion(prefs.motion)
  const prefsMutation = useWellnessPrefsMutation(userId)
  const dockMutation = useDockPrefsMutation(userId)

  const learnerStateQuery = useLearnerState()
  const profile = learnerStateQuery.data?.profile ?? null
  const profileMutation = useProfileMutation(userId)

  const diagnostics = useDiagnostics()

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  const activeTheme: ThemeName = isThemeName(theme) ? theme : 'midnight'

  function applyTheme(id: ThemeName) {
    if (id === activeTheme) return
    const root = document.documentElement
    root.setAttribute('data-theme-switching', '')
    const canAnimate = !reducedMotion && typeof document.startViewTransition === 'function'
    if (canAnimate) document.startViewTransition!(() => flushSync(() => setTheme(id)))
    else setTheme(id)
    window.setTimeout(() => root.removeAttribute('data-theme-switching'), 350)
  }

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
      setError('The password could not be changed. Try again shortly.')
    } finally {
      setSubmitting(false)
    }
  }

  async function signOut() {
    if (signingOut) return
    setSigningOut(true)
    try {
      await createClient().auth.signOut()
    } finally {
      // A full document navigation, not router.push -- the query cache and
      // every other client-side store must not survive into the next
      // signed-in session on this tab (src/lib/query/client.ts's own note on
      // why sign-out has always been a hard navigation in this app).
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- deliberate hard navigation, not a routing bug
      window.location.href = '/login'
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-medium tracking-tight">Account</h1>
        <p className="mt-2 text-sm text-muted-foreground">{user?.email ?? 'Account email is unavailable.'}</p>
      </div>

      <Section id="make-it-yours-heading" title="Make it yours">
        <div className="space-y-1.5">
          <span className="text-sm font-medium text-foreground">Theme</span>
          <div role="radiogroup" aria-label="Theme" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {THEMES.map((entry) => {
              const checked = entry.id === activeTheme
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  onClick={() => applyTheme(entry.id)}
                  className={cn(
                    'flex flex-col items-start gap-1.5 rounded-lg border p-2 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-emerald-300',
                    checked ? 'border-emerald-300 ring-1 ring-emerald-300/50' : 'border-border hover:border-ring/50',
                  )}
                >
                  <span className="flex gap-1" aria-hidden="true">
                    {entry.swatch.map((color, index) => (
                      <span key={index} className="size-3 rounded-full border border-border/50" style={{ backgroundColor: color }} />
                    ))}
                  </span>
                  <span className="font-medium text-foreground">{entry.name}</span>
                </button>
              )
            })}
          </div>
        </div>

        <RadioPills
          label="Dock placement"
          options={DOCK_PLACEMENTS}
          value={prefs.dock.placement}
          onChange={(placement) => dockMutation.mutate(() => ({ placement }))}
        />
        <SettingToggle
          id="dock-collapse"
          label="Collapse the dock"
          checked={prefs.dock.collapsed}
          onChange={(collapsed) => dockMutation.mutate(() => ({ collapsed }))}
          reducedMotion={reducedMotion}
        />
        <SettingToggle
          id="dock-compact-exercise"
          label="Compact on rep and walkthrough screens"
          checked={prefs.dock.compactOnExercise}
          onChange={(compactOnExercise) => dockMutation.mutate(() => ({ compactOnExercise }))}
          reducedMotion={reducedMotion}
        />

        <SettingToggle
          id="sound-enabled"
          label="Sound on"
          checked={prefs.sound.enabled}
          onChange={(enabled) => prefsMutation.mutate((current) => ({ sound: { ...current.sound, enabled } }))}
          reducedMotion={reducedMotion}
        />
        <div className="space-y-1.5">
          <label htmlFor="sound-volume" className="text-sm font-medium text-foreground">Volume</label>
          <input
            id="sound-volume"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={prefs.sound.volume}
            onChange={(event) => prefsMutation.mutate((current) => ({ sound: { ...current.sound, volume: Number(event.target.value) } }))}
            className="w-full accent-emerald-300"
          />
        </div>
        <SettingToggle
          id="sound-interface"
          label="Interface sounds (run, submit, clicks)"
          checked={prefs.sound.interface}
          onChange={(next) => prefsMutation.mutate((current) => ({ sound: { ...current.sound, interface: next } }))}
          reducedMotion={reducedMotion}
        />

        <RadioPills
          label="Motion"
          options={MOTION_OPTIONS}
          value={prefs.motion}
          onChange={(motion) => prefsMutation.mutate(() => ({ motion }))}
        />

        <div className="space-y-1.5">
          <span id="daily-goal-label" className="text-sm font-medium text-foreground">Daily goal</span>
          <div className="flex items-center gap-3" role="group" aria-labelledby="daily-goal-label">
            <Button
              type="button" variant="outline" size="icon" aria-label="Decrease daily goal"
              disabled={prefs.dailyGoal <= 1}
              onClick={() => prefsMutation.mutate((current) => ({ dailyGoal: Math.max(1, current.dailyGoal - 1) }))}
            >
              −
            </Button>
            <span data-testid="daily-goal-value" className="tabular w-8 text-center text-sm font-medium text-foreground" aria-live="polite">{prefs.dailyGoal}</span>
            <Button
              type="button" variant="outline" size="icon" aria-label="Increase daily goal"
              disabled={prefs.dailyGoal >= 10}
              onClick={() => prefsMutation.mutate((current) => ({ dailyGoal: Math.min(10, current.dailyGoal + 1) }))}
            >
              +
            </Button>
          </div>
        </div>
      </Section>

      {profile && (
        <Section id="bro-talks-heading" title="How the Bro talks">
          <RadioPills label="Tone" options={TONE_OPTIONS} value={profile.tone} onChange={(tone) => profileMutation.mutate(() => ({ tone }))} />
          <RadioPills label="Verbosity" options={VERBOSITY_OPTIONS} value={profile.verbosity} onChange={(verbosity) => profileMutation.mutate(() => ({ verbosity }))} />
          <RadioPills
            label="Depth"
            options={DEPTH_OPTIONS}
            value={profile.motivation.depth}
            onChange={(depth) => profileMutation.mutate((current) => ({ motivation: { ...current.motivation, depth } }))}
          />
          <SettingToggle
            id="beyond-courses"
            label="Go beyond the course curriculum when it helps"
            checked={profile.motivation.beyondCourses}
            onChange={(beyondCourses) => profileMutation.mutate((current) => ({ motivation: { ...current.motivation, beyondCourses } }))}
            reducedMotion={reducedMotion}
          />
        </Section>
      )}

      <Section id="integrity-heading" title="Integrity explained">
        <IntegrityPanel />
      </Section>

      <Section id="diagnostics-heading" title="Diagnostics">
        <p className="text-xs leading-relaxed text-muted-foreground">Local performance signals from this device, this tab, this session only. Nothing here is uploaded.</p>
        {diagnostics.length === 0 ? (
          <p className="text-sm text-muted-foreground">No signals recorded yet this session.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {[...diagnostics].reverse().map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{DIAGNOSTIC_LABEL[entry.metric]}</span>
                <span className="tabular font-medium text-foreground">{formatDiagnosticValue(entry.metric, entry.value)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="password-heading" title="Password">
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
          {success && <p role="status" className="text-sm leading-relaxed text-emerald-300">Password changed.</p>}
          <Button type="submit" disabled={submitting} className="h-12 w-full bg-emerald-300 text-primary-foreground hover:bg-emerald-200">
            {submitting ? 'Changing password…' : 'Change password'}
          </Button>
        </form>
      </Section>

      <Section id="sign-out-heading" title="Sign out">
        <p className="text-sm leading-relaxed text-muted-foreground">Signs this device out of the account.</p>
        <Button type="button" variant="outline" disabled={signingOut} onClick={() => void signOut()}>
          {signingOut ? 'Signing out…' : 'Sign out'}
        </Button>
      </Section>
    </div>
  )
}
