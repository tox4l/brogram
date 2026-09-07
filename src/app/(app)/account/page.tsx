'use client'

import { useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createClient } from '@/lib/supabase/client'
import { useSession } from '@/store/session'
import { useLearnerState, useWellness } from '@/lib/query/hooks'
import { resolveWellnessPrefs } from '@/lib/wellness/prefs'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'
import { THEME_SEED_MARKER_KEY, THEMES } from '@/lib/theme/themes'
import { IntegrityPanel } from '@/components/account/IntegrityPanel'
import { cn } from '@/lib/utils'
import type { DockPlacement, LearnerProfile, MotionPreference, ThemeName, Tone, Verbosity } from '@/lib/contracts'
import { useWellnessPrefsMutation } from './prefsMutation'
import { useProfileMutation } from './profileMutation'
import { useDiagnostics, type DiagnosticMetric } from './diagnostics'

const MIN_PASSWORD_LENGTH = 8

/**
 * `true` once the client has painted at least once; `false` on the server
 * render and the first client render (identical output, no hydration
 * mismatch). `useSyncExternalStore` with a `getServerSnapshot` that differs
 * from `getSnapshot` is the documented way to get this one, cascade-render
 * flag without the `useState(false)` + `useEffect(() => setState(true))`
 * pattern the React Compiler lint (`react-hooks/set-state-in-effect`) now
 * rejects outright -- the same trick `useReducedMotion`
 * (`src/lib/motion/useReducedMotion.ts`) already uses for its own
 * server/client snapshot split. There is nothing to subscribe to (this never
 * changes again after the first paint), so `subscribe` is a no-op.
 */
function subscribeNever(): () => void { return () => {} }
function useMounted(): boolean {
  return useSyncExternalStore(subscribeNever, () => true, () => false)
}

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

// Wave 4 spec section 9, /account: "labels at --text-micro uppercase" -- the
// short eyebrow label that heads a field or a group of options (never the
// longer descriptive text next to a toggle, which stays body-adjacent).
const LABEL_CLASS = 'text-micro font-medium uppercase tracking-[0.06em] text-muted-foreground'

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
    <section aria-labelledby={id} className="space-y-4 rounded-xl border border-rule p-4">
      <h2 id={id} className="text-lede font-medium text-foreground">{title}</h2>
      {children}
    </section>
  )
}

/** WAI-ARIA radiogroup arrow-key handling, shared by every `RadioPills`
 *  instance and the theme grid below (mirrors `ThemeQuickSwitch`'s own
 *  `moveTo`/`onRadioKeyDown` -- fix round 1, I3: without this every option
 *  here was a plain button with default tabIndex and no keydown handler, so
 *  arrow keys did nothing and Tab walked every option individually instead
 *  of the roving-tabindex model a "radio group" announces). Right/Down move
 *  to the next option, Left/Up to the previous, Home/End jump to the ends;
 *  moving also selects, matching native radio semantics. */
function useRovingRadioGroup<T>(values: readonly T[], activeIndex: number, onChange: (next: T) => void) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  function moveTo(index: number) {
    const wrapped = (index + values.length) % values.length
    refs.current[wrapped]?.focus()
    onChange(values[wrapped])
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); moveTo(index + 1) }
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); moveTo(index - 1) }
    else if (event.key === 'Home') { event.preventDefault(); moveTo(0) }
    else if (event.key === 'End') { event.preventDefault(); moveTo(values.length - 1) }
  }

  return {
    ref: (index: number) => (el: HTMLButtonElement | null) => { refs.current[index] = el },
    tabIndex: (index: number) => (index === Math.max(0, activeIndex) ? 0 : -1),
    onKeyDown,
  }
}

function RadioPills<T extends string>({ label, options, value, onChange }: {
  label: string
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (next: T) => void
}) {
  const activeIndex = options.findIndex((option) => option.value === value)
  const roving = useRovingRadioGroup(options.map((option) => option.value), activeIndex, onChange)

  return (
    <div className="space-y-2">
      <span className={LABEL_CLASS}>{label}</span>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
        {options.map((option, index) => {
          const checked = option.value === value
          return (
            <button
              key={option.value}
              ref={roving.ref(index)}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={roving.tabIndex(index)}
              onClick={() => onChange(option.value)}
              onKeyDown={(event) => roving.onKeyDown(event, index)}
              className={cn(
                'rounded-full border px-3 py-2 text-small outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                checked ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground',
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
      <label htmlFor={id} className="text-small text-foreground">{label}</label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn('relative h-6 w-11 shrink-0 rounded-full border border-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background', checked ? 'bg-primary' : 'bg-muted')}
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
  // C1, fix round 1 (Opus review of b509b0e): a single writer for
  // `wellness.prefs` -- the dock controls below call this same mutation
  // (`useDockPrefsMutation`, used elsewhere by the persistent dock widget,
  // now itself delegates here) rather than a second, independent debounced
  // hook racing this one over the same JSONB blob.
  const prefsMutation = useWellnessPrefsMutation(userId)

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

  // I2, fix round 1: `useTheme().theme` is `undefined` on the server render
  // and on the very first client render, before next-themes hydrates from
  // storage/the DOM attribute. Falling back to `'midnight'` in that window
  // (the previous behaviour) rings the Midnight swatch even when the actual
  // applied theme is something else entirely, and makes Midnight itself
  // unselectable (the old `id === activeTheme` early-return fires on a false
  // match). `mounted` is false on both server and first client render
  // (identical output, no hydration mismatch) and flips true on its own the
  // next paint -- until then no swatch is marked checked and clicks are
  // ignored outright, rather than silently comparing against a guessed value.
  const mounted = useMounted()
  const activeTheme: ThemeName | null = mounted && isThemeName(theme) ? theme : null

  // X5 (wave 2 review): the canonical theme picker only ever called
  // `setTheme`, so a choice made here never left `localStorage` -- signing in
  // on another device re-seeded a theme from the OS instead of carrying this
  // one across. `prefsMutation` is the same single wellness-prefs writer
  // every other control on this page already uses (W2FIX-F4); writing
  // `{ theme: id }` through it is symmetrical with `ThemeQuickSwitch`'s own
  // write (`src/lib/theme/useThemeSync.ts`'s doc comment records the one
  // known gap this pair still has: `prefsPatch` strips a value equal to
  // `DEFAULT_WELLNESS`, so an explicit re-pick of the seeded default,
  // Midnight, is indistinguishable from "never chosen").
  function applyTheme(id: ThemeName) {
    if (!mounted || id === activeTheme) return
    const root = document.documentElement
    root.setAttribute('data-theme-switching', '')
    // G2 (wave 2 review, section 6): a real pick from here is no longer an
    // unconfirmed device seed -- clear the marker `seedInitialTheme` wrote
    // so `useThemeSync`'s write-back skip stops applying and this choice
    // reaches `wellness.prefs` like any other.
    try { window.localStorage.removeItem(THEME_SEED_MARKER_KEY) } catch { /* no storage access */ }
    const canAnimate = !reducedMotion && typeof document.startViewTransition === 'function'
    if (canAnimate) document.startViewTransition!(() => flushSync(() => setTheme(id)))
    else setTheme(id)
    window.setTimeout(() => root.removeAttribute('data-theme-switching'), 350)
    prefsMutation.mutate(() => ({ theme: id }))
  }

  const themeRoving = useRovingRadioGroup(THEME_IDS, Math.max(0, THEME_IDS.indexOf(activeTheme ?? THEME_IDS[0])), applyTheme)

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

  // Wave 4 spec section 4: --measure-form is 34rem. The token itself never
  // landed in globals.css (T4.0's row; not part of this task's ownership) --
  // the literal value is used directly here and flagged in the T4.5 report
  // as a gap for a future token-layer pass.
  return (
    <div className="max-w-[34rem] space-y-6">
      <div>
        <h1 className="text-lede font-medium tracking-tight">Account</h1>
        <p className="mt-2 text-small text-muted-foreground">{user?.email ?? 'Account email is unavailable.'}</p>
      </div>

      <Section id="make-it-yours-heading" title="Make it yours">
        <div className="space-y-2">
          <span className={LABEL_CLASS}>Theme</span>
          <div role="radiogroup" aria-label="Theme" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {THEMES.map((entry, index) => {
              const checked = mounted && entry.id === activeTheme
              return (
                <button
                  key={entry.id}
                  ref={themeRoving.ref(index)}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  tabIndex={themeRoving.tabIndex(index)}
                  onClick={() => applyTheme(entry.id)}
                  onKeyDown={(event) => themeRoving.onKeyDown(event, index)}
                  className={cn(
                    'flex min-h-11 flex-col items-start justify-center gap-2 rounded-lg border p-2 text-left text-micro outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                    checked ? 'border-ring ring-1 ring-ring/50' : 'border-border hover:border-ring/50',
                  )}
                >
                  <span className="flex gap-1" aria-hidden="true">
                    {entry.swatch.map((color, index) => (
                      <span key={index} className="size-5 rounded-full border border-border/50" style={{ backgroundColor: color }} />
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
          onChange={(placement) => prefsMutation.mutate((current) => ({ dock: { ...current.dock, placement } }))}
        />
        <SettingToggle
          id="dock-collapse"
          label="Collapse the dock"
          checked={prefs.dock.collapsed}
          onChange={(collapsed) => prefsMutation.mutate((current) => ({ dock: { ...current.dock, collapsed } }))}
          reducedMotion={reducedMotion}
        />
        <SettingToggle
          id="dock-compact-exercise"
          label="Compact on rep and walkthrough screens"
          checked={prefs.dock.compactOnExercise}
          onChange={(compactOnExercise) => prefsMutation.mutate((current) => ({ dock: { ...current.dock, compactOnExercise } }))}
          reducedMotion={reducedMotion}
        />

        <SettingToggle
          id="sound-enabled"
          label="Sound on"
          checked={prefs.sound.enabled}
          onChange={(enabled) => prefsMutation.mutate((current) => ({ sound: { ...current.sound, enabled } }))}
          reducedMotion={reducedMotion}
        />
        <div className="space-y-2">
          <label htmlFor="sound-volume" className={LABEL_CLASS}>Volume</label>
          <input
            id="sound-volume"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={prefs.sound.volume}
            onChange={(event) => prefsMutation.mutate((current) => ({ sound: { ...current.sound, volume: Number(event.target.value) } }))}
            className="w-full accent-primary"
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

        <div className="space-y-2">
          <span id="daily-goal-label" className={LABEL_CLASS}>Daily goal</span>
          <div className="flex items-center gap-3" role="group" aria-labelledby="daily-goal-label">
            <Button
              type="button" variant="outline" size="icon" aria-label="Decrease daily goal"
              disabled={prefs.dailyGoal <= 1}
              onClick={() => prefsMutation.mutate((current) => ({ dailyGoal: Math.max(1, current.dailyGoal - 1) }))}
            >
              −
            </Button>
            <span data-testid="daily-goal-value" className="tabular w-8 text-center text-small font-medium text-foreground" aria-live="polite">{prefs.dailyGoal}</span>
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

      {/* I1, fix round 1: IntegrityPanel's `full` variant already renders its
          own <h2 id="integrity-heading">, so this is a plain bordered wrapper
          for visual consistency with the other sections -- not a `Section`,
          which would duplicate both the heading text and the DOM id.
          `crossedAt={null}`: the plain Account view has no single threshold
          being explained (unlike a warned/restricted notice), per the
          prop's own doc comment. */}
      <div className="rounded-xl border border-rule p-4">
        <IntegrityPanel crossedAt={null} />
      </div>

      <Section id="diagnostics-heading" title="Diagnostics">
        <p className="text-small leading-relaxed text-muted-foreground">Local performance signals from this device, this tab, this session only. Nothing here is uploaded.</p>
        {diagnostics.length === 0 ? (
          <p className="text-small text-muted-foreground">No signals recorded yet this session.</p>
        ) : (
          <ul className="space-y-2 text-small">
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
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="new-password" className={LABEL_CLASS}>New password</label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              disabled={submitting}
              onChange={(event) => { setPassword(event.target.value); setError(null); setSuccess(false) }}
              className="h-12 text-body"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="confirm-password" className={LABEL_CLASS}>Confirm new password</label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              value={confirmPassword}
              disabled={submitting}
              onChange={(event) => { setConfirmPassword(event.target.value); setError(null); setSuccess(false) }}
              className="h-12 text-body"
            />
          </div>
          <p className="text-small leading-relaxed text-muted-foreground">Use at least {MIN_PASSWORD_LENGTH} characters.</p>
          {error && <p role="alert" className="text-small text-foreground">{error}</p>}
          {success && <p role="status" className="text-small leading-relaxed text-success">Password changed.</p>}
          <Button type="submit" disabled={submitting} className="h-12 w-full">
            {submitting ? 'Changing password…' : 'Change password'}
          </Button>
        </form>
      </Section>

      <Section id="sign-out-heading" title="Sign out">
        <p className="text-small leading-relaxed text-muted-foreground">Signs this device out of the account.</p>
        <Button type="button" variant="outline" disabled={signingOut} onClick={() => void signOut()}>
          {signingOut ? 'Signing out…' : 'Sign out'}
        </Button>
      </Section>
    </div>
  )
}
